"""Persistent single-channel JSON-RPC worker for SSH bastions that block exec."""
import os, sys, json, base64, signal, subprocess, threading

if sys.stdin.isatty():
    try:
        import termios
        settings = termios.tcgetattr(sys.stdin)
        settings[0] &= ~(termios.IXON | termios.IXOFF)
        settings[3] &= ~(termios.ICANON | termios.ECHO | termios.ISIG)
        settings[6][termios.VMIN] = 1
        settings[6][termios.VTIME] = 0
        termios.tcsetattr(sys.stdin, termios.TCSANOW, settings)
    except Exception:
        sys.exit(1)

PREFIX = '__DSH_RPC__:'
FILE_NS = {'__name__': 'dsh_file_worker'}
write_lock = threading.Lock()
procs = {}
procs_lock = threading.Lock()

def emit(msg):
    line = PREFIX + json.dumps(msg, ensure_ascii=True, separators=(',', ':')) + '\n'
    with write_lock:
        sys.stdout.write(line)
        sys.stdout.flush()

def run_file(query):
    try:
        return dict(ok=True, value=FILE_NS['main'](query))
    except Exception as error:
        text = str(error)
        code = text if text.startswith('FS_') else 'FS_NOT_FOUND' if isinstance(error, (FileNotFoundError, NotADirectoryError)) else 'FS_PERMISSION_DENIED' if isinstance(error, PermissionError) else 'FS_IO_ERROR'
        return dict(ok=False, code=code, message=text)

def run_browse(path):
    target = os.path.expanduser(path or '.')
    canonical = os.path.realpath(target)
    if not os.path.isdir(canonical):
        raise ValueError('NOT_DIRECTORY')
    dirs = []
    with os.scandir(canonical) as entries:
        for entry in entries:
            if entry.name in ('.', '..'):
                continue
            try:
                is_link = entry.is_symlink()
                is_dir = entry.is_dir()
            except OSError:
                is_link, is_dir = False, False
            if is_dir or is_link:
                dirs.append(dict(name=entry.name, symlink=is_link))
    dirs.sort(key=lambda d: d['name'])
    return dict(path=canonical, directories=dirs[:2000], truncated=len(dirs) > 2000)

def start_proc(rid, spec):
    env = dict(os.environ)
    env.update(spec.get('env') or {})
    cwd = os.path.expanduser(spec.get('cwd') or '~')
    proc = subprocess.Popen(
        spec['argv'],
        cwd=cwd,
        env=env,
        stdin=subprocess.PIPE if spec.get('hasStdin') else subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    with procs_lock:
        procs[rid] = proc

    def pump(stream, kind):
        try:
            while True:
                chunk = stream.read1(16384)
                if not chunk:
                    break
                emit(dict(id=rid, event=kind, data=base64.b64encode(chunk).decode()))
        except Exception:
            pass

    t_out = threading.Thread(target=pump, args=(proc.stdout, 'stdout'), daemon=True)
    t_err = threading.Thread(target=pump, args=(proc.stderr, 'stderr'), daemon=True)
    t_out.start()
    t_err.start()

    def wait_proc():
        code = proc.wait()
        t_out.join(timeout=2)
        t_err.join(timeout=2)
        with procs_lock:
            procs.pop(rid, None)
        emit(dict(id=rid, event='exit', exitCode=code))

    threading.Thread(target=wait_proc, daemon=True).start()
    emit(dict(id=rid, ok=True, value=dict(pid=proc.pid)))

def handle_line(raw):
    req = json.loads(raw)
    rid = req['id']
    op = req.get('op')
    try:
        if op == 'init_file':
            exec(base64.b64decode(req['source']).decode('utf-8'), FILE_NS)
            emit(dict(id=rid, ok=True, value=True))
        elif op == 'ping':
            emit(dict(id=rid, ok=True, value=dict(python=sys.version.split()[0])))
        elif op == 'browse':
            emit(dict(id=rid, ok=True, value=run_browse(req.get('path', '.'))))
        elif op == 'file':
            emit(dict(id=rid, ok=True, value=run_file(req['query'])))
        elif op == 'exec_start':
            start_proc(rid, req['spec'])
        elif op == 'exec_stdin':
            with procs_lock:
                proc = procs.get(req['targetId'])
            if proc and proc.stdin:
                if req.get('eof'):
                    proc.stdin.close()
                elif req.get('data'):
                    proc.stdin.write(base64.b64decode(req['data']))
                    proc.stdin.flush()
            emit(dict(id=rid, ok=True, value=True))
        elif op == 'exec_kill':
            with procs_lock:
                proc = procs.get(req['targetId'])
            if proc:
                try:
                    os.killpg(proc.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
            emit(dict(id=rid, ok=True, value=True))
        else:
            emit(dict(id=rid, ok=False, code='ACTION_INVALID', message='Unknown RPC op'))
    except Exception as error:
        emit(dict(id=rid, ok=False, code='SHELL_RPC_ERROR', message=str(error)))

for line in sys.stdin:
    text = line.strip()
    if not text:
        continue
    if text == '__DSH_QUIT__':
        break
    threading.Thread(target=handle_line, args=(text,), daemon=True).start()

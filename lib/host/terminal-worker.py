# A Linux PTY owned by one SSH channel. The channel carries framed data and
# controls, never an interpreted shell command. No persistent remote service.
import os, sys, json, base64, pty, fcntl, termios, struct, selectors, signal, time, errno

def send(value):
    print(json.dumps(value, ensure_ascii=True, separators=(',', ':')), flush=True)

def main(q):
    if not sys.platform.startswith('linux') or not os.path.isdir('/proc/self'):
        raise RuntimeError('SSH interactive terminals currently require Linux /proc')
    cwd = os.path.realpath(q['cwd'])
    if not os.path.isdir(cwd): raise RuntimeError('Remote terminal directory does not exist')
    cols, rows = int(q['cols']), int(q['rows'])
    if not 2 <= cols <= 500 or not 1 <= rows <= 200: raise ValueError('Invalid terminal dimensions')
    environment = dict(os.environ)
    environment.update(q.get('env', {}))
    environment['TERM'] = q.get('terminalType') or 'xterm-256color'
    # Python and its child use the server's locale and executable search path.
    pid, master = pty.fork()
    if pid == 0:
        try:
            os.chdir(cwd)
            os.execvpe(q['argv'][0], q['argv'], environment)
        except Exception as error:
            os.write(2, ('Remote shell failed: %s\r\n' % error).encode('utf-8'))
            os._exit(127)
    os.set_blocking(master, False)
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
    pending, incoming = bytearray(), bytearray()
    status, eof, stopping = None, False, None
    phase, revision, last_activity = 0, 0, None
    grace = min(max(q.get('graceMs', 1000) / 1000, 0.1), 5)
    selector = selectors.DefaultSelector()
    selector.register(master, selectors.EVENT_READ)
    selector.register(sys.stdin.fileno(), selectors.EVENT_READ)

    def members():
        result = []
        for name in os.listdir('/proc'):
            if not name.isdigit(): continue
            try:
                with open('/proc/%s/stat' % name) as file: fields = file.read().rsplit(')', 1)[1].split()
                if int(fields[3]) == pid and fields[0] != 'Z': result.append((int(name), fields[19]))
            except (OSError, ValueError, IndexError): pass
        return result

    def kill_members(number):
        for member, started in members():
            try:
                with open('/proc/%s/stat' % member) as file: fields = file.read().rsplit(')', 1)[1].split()
                if int(fields[3]) == pid and fields[19] == started: os.kill(member, number)
            except (OSError, ValueError, IndexError): pass

    def stop():
        nonlocal stopping
        if stopping is None:
            stopping = time.monotonic()
            kill_members(signal.SIGHUP)

    def on_signal(_number, _frame): stop()
    for number in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT): signal.signal(number, on_signal)

    def request(message):
        nonlocal revision, last_activity
        op = message['op']
        if op == 'write':
            data = base64.b64decode(message['data'], validate=True)
            if len(data) > 65536 or len(pending) + len(data) > 1048576: raise ValueError('Terminal input exceeds limit')
            pending.extend(data); revision += 1
            return None
        if op == 'resize':
            columns, lines = int(message['cols']), int(message['rows'])
            if not 2 <= columns <= 500 or not 1 <= lines <= 200: raise ValueError('Invalid terminal dimensions')
            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', lines, columns, 0, 0))
            return None
        if op == 'terminate': stop(); return None
        foreground = os.tcgetpgrp(master)
        if op == 'foreground': return dict(processGroupId=foreground)
        if op == 'activity':
            # No prompt heuristics: a shell at its own foreground is unknown.
            # Descendants are positive evidence of work; uncertainty never means idle.
            state = 'busy' if foreground != pid or any(member != pid for member, _ in members()) else 'unknown'
            if state != last_activity: last_activity = state; revision += 1
            return dict(state=state, revision=revision)
        if op == 'signal':
            name = message['signal']
            if name not in ('SIGINT', 'SIGTERM', 'SIGKILL', 'SIGTSTP', 'SIGHUP'): raise ValueError('Unsupported terminal signal')
            if name == 'SIGKILL' and foreground == pid: raise ValueError('Refusing to SIGKILL the shell foreground; close the terminal instead')
            os.killpg(foreground, getattr(signal, name))
            return foreground
        raise ValueError('Unknown terminal operation')

    try:
        send(dict(type='ready', pid=pid))
        while True:
            if status is None:
                observed, value = os.waitpid(pid, os.WNOHANG)
                if observed:
                    status = value
                    stop()
            if stopping is not None:
                elapsed = time.monotonic() - stopping
                if elapsed >= grace and phase < 1: kill_members(signal.SIGTERM); phase = 1
                if elapsed >= grace * 2 and phase < 2: kill_members(signal.SIGKILL); phase = 2
                if status is not None and not members() and eof: break
                if elapsed > grace * 2 + 5: raise RuntimeError('Remote terminal process cleanup could not be confirmed')
            selector.modify(master, selectors.EVENT_READ | (selectors.EVENT_WRITE if pending and not eof else 0)) if not eof else None
            for key, events in selector.select(0.05):
                if key.fd == master:
                    if events & selectors.EVENT_WRITE:
                        try: del pending[:os.write(master, pending)]
                        except BlockingIOError: pass
                    if events & selectors.EVENT_READ:
                        try: data = os.read(master, 16384)
                        except OSError as error:
                            if error.errno != errno.EIO: raise
                            data = b''
                        if data: send(dict(type='output', data=base64.b64encode(data).decode('ascii')))
                        else: eof = True; pending.clear(); selector.unregister(master)
                else:
                    data = os.read(sys.stdin.fileno(), 65536)
                    if not data: selector.unregister(sys.stdin.fileno()); stop(); continue
                    incoming.extend(data)
                    if len(incoming) > 1048576: raise ValueError('Terminal frame exceeds limit')
                    while b'\n' in incoming:
                        line, _, rest = incoming.partition(b'\n'); incoming = bytearray(rest)
                        message = json.loads(line)
                        try: send(dict(type='reply', id=message['id'], value=request(message)))
                        except Exception as error: send(dict(type='reply', id=message.get('id'), error=str(error)))
        code = os.waitstatus_to_exitcode(status)
        send(dict(type='exit', exitCode=code if code >= 0 else None, signal=signal.Signals(-code).name if code < 0 else None))
    finally:
        kill_members(signal.SIGKILL)
        if status is None:
            try: os.waitpid(pid, 0)
            except ChildProcessError: pass
        os.close(master); selector.close()

try:
    main(json.loads(base64.b64decode(sys.argv[1])))
except Exception as error:
    try: send(dict(type='error', message=str(error)))
    except (BrokenPipeError, OSError): pass
    sys.exit(1)

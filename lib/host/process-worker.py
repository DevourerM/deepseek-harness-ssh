import os, sys, json, base64, subprocess, signal, threading
q = json.loads(base64.b64decode(sys.argv[1]))
environment = dict(os.environ)
environment.update(q.get('env', {}))
child = None
stopped = False
def stop(number, _frame):
    global stopped
    stopped = True
    if child is None: return
    try: os.killpg(child.pid, number)
    except ProcessLookupError: pass
    def force():
        if child.poll() is None:
            try: os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError: pass
    timer = threading.Timer(3, force); timer.daemon = True; timer.start()
signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
signal.signal(signal.SIGHUP, stop)
print('DSH_SSH_CONTROL:%s:%s' % (q['control'], os.getpid()), file=sys.stderr, flush=True)
child = subprocess.Popen(q['argv'], cwd=q['cwd'], env=environment, start_new_session=True)
if stopped: stop(signal.SIGTERM, None)
code = child.wait()
sys.exit(code if code >= 0 else 128 - code)

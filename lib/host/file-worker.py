"""Stateless filesystem helper; no model, account, or DSH runtime on the server."""
import os, sys, json, base64, hashlib, stat, tempfile, fcntl, fnmatch, re

def version(path):
    info = os.stat(path)
    return '%s:%s:%s:%s' % (info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)

def describe(path, follow=True):
    try:
        info = os.stat(path) if follow else os.lstat(path)
    except (FileNotFoundError, NotADirectoryError):
        return None
    kind = 'directory' if stat.S_ISDIR(info.st_mode) else 'file' if stat.S_ISREG(info.st_mode) else 'symlink' if stat.S_ISLNK(info.st_mode) else 'other'
    return dict(type=kind, size=info.st_size, version='%s:%s:%s:%s' % (info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns))

def main(q):
    path = q['path']; action = q['action']
    if action == 'resolve': return dict(path=os.path.realpath(path))
    if action in ('stat', 'lstat'): return describe(path, action == 'stat')
    if action in ('glob', 'grep'):
        pattern = q['pattern']; include = q.get('include'); result = []; visited = 0; truncated = False
        regex = re.compile(pattern) if action == 'grep' else None
        def matches(name, pattern):
            return fnmatch.fnmatchcase(name, pattern) or pattern.startswith('**/') and fnmatch.fnmatchcase(name, pattern[3:])
        if os.path.isfile(path): candidates = [(os.path.dirname(path), [], [os.path.basename(path)])]; root = os.path.dirname(path)
        else: candidates = os.walk(path, followlinks=False); root = path
        for directory, directories, names in candidates:
            directories[:] = sorted(d for d in directories if not d.startswith('.') and d not in ('node_modules', '__pycache__'))
            for name in sorted(names):
                visited += 1
                if visited > 10000 or len(result) >= 1000: truncated = True; break
                full = os.path.join(directory, name); relative = os.path.relpath(full, root)
                if name.startswith('.'): continue
                if action == 'glob':
                    if matches(relative, pattern): result.append(full)
                elif not include or matches(relative, include):
                    try:
                        if os.stat(full).st_size > 2097152: continue
                        with open(full, 'r', encoding='utf-8') as file:
                            for number, line in enumerate(file, 1):
                                if '\x00' in line: break
                                if regex.search(line): result.append(dict(path=full, lineNumber=number, line=line.rstrip('\r\n')[:2000]))
                                if len(result) >= 1000: truncated = True; break
                    except (OSError, UnicodeError): pass
            if truncated: break
        return dict(results=result, truncated=truncated)
    if action == 'list':
        result = []
        with os.scandir(path) as entries:
            for entry in entries:
                if len(result) >= 20000: raise ValueError('Directory has more than 20000 entries')
                info = describe(entry.path, False)
                if info: result.append(dict(name=entry.name, **info))
        return sorted(result, key=lambda entry: entry['name'])
    if action == 'read':
        limit = q.get('limit', 16777216); offset = q.get('offset', 0)
        if not stat.S_ISREG(os.stat(path).st_mode): raise ValueError('Not a regular file')
        with open(path, 'rb') as file:
            file.seek(offset); data = file.read(limit + 1)
        if len(data) > limit and not q.get('range'): raise ValueError('FS_TOO_LARGE')
        return dict(data=base64.b64encode(data[:limit]).decode())
    if action not in ('write', 'edit'): raise ValueError('Unsupported filesystem action')
    # Guard and mutation share a remote advisory lock. Recheck realpaths under
    # that lock, including symlinks, before publishing with an atomic rename.
    locks = os.path.expanduser('~/.dsh-ssh/file-locks'); os.makedirs(locks, mode=0o700, exist_ok=True)
    canonical = os.path.realpath(path); key = hashlib.sha256(canonical.encode()).hexdigest()
    with open(os.path.join(locks, key), 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        path = os.path.realpath(path); root = os.path.realpath(q['root']); mode = q['mode']
        if mode == 'read-only' or mode != 'danger-full-access' and os.path.commonpath([root, path]) != root:
            raise ValueError('FS_SANDBOX_DENIED')
        info = describe(path); expected = q.get('expected') or {}
        if info and info['type'] != 'file': raise ValueError('FS_NOT_REGULAR_FILE')
        if expected.get('kind') == 'createIfAbsent' and info: raise ValueError('FS_NOT_OBSERVED')
        if expected.get('version') and (not info or info['version'] != expected['version']): raise ValueError('FS_STALE_VERSION')
        before = None
        if info:
            if info['size'] > 16777216: raise ValueError('FS_TOO_LARGE')
            with open(path, 'r', encoding='utf-8', newline='') as file: before = file.read()
        if action == 'edit':
            if before is None: raise ValueError('FS_NOT_FOUND')
            old = q['edit']['oldString']; new = q['edit']['newString']; all_matches = q['edit'].get('replaceAll', False)
            if not old: raise ValueError('FS_EDIT_EMPTY_MATCH')
            count = before.count(old)
            if not count: raise ValueError('FS_EDIT_NOT_FOUND')
            if count > 1 and not all_matches: raise ValueError('FS_EDIT_AMBIGUOUS')
            content = before.replace(old, new) if all_matches else before.replace(old, new, 1)
        else: content = q['content']
        parent = os.path.dirname(path)
        os.makedirs(parent, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix='.dsh-ssh-', dir=parent)
        try:
            if info: os.fchmod(fd, stat.S_IMODE(os.stat(path).st_mode))
            with os.fdopen(fd, 'w', encoding='utf-8', newline='') as file:
                file.write(content); file.flush(); os.fsync(file.fileno())
            if expected.get('kind') == 'createIfAbsent': os.link(temporary, path); os.unlink(temporary)
            else: os.replace(temporary, path)
        finally:
            if os.path.exists(temporary): os.unlink(temporary)
        outcome = dict(version=version(path), before=before, after=content)
        if action == 'write': outcome['operation'] = 'update' if info else 'create'
        return outcome

try:
    query = json.load(sys.stdin)
    print(json.dumps(dict(ok=True, value=main(query)), ensure_ascii=True))
except Exception as error:
    code = str(error) if str(error).startswith('FS_') else 'FS_NOT_FOUND' if isinstance(error, (FileNotFoundError, NotADirectoryError)) else 'FS_PERMISSION_DENIED' if isinstance(error, PermissionError) else 'FS_IO_ERROR'
    print(json.dumps(dict(ok=False, code=code, message=str(error))))

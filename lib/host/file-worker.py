"""Stateless filesystem helper; no model, account, or DSH runtime on the server."""
import os, sys, json, base64, hashlib, stat, tempfile, fcntl, fnmatch, re, shutil

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

def sidebar(q):
    root = os.path.realpath(q['root']); path = q['path']; op = q['op']
    def checked(value, lexical=False):
        if not isinstance(value, str) or '\x00' in value: raise ValueError('Invalid path')
        value = os.path.normpath(os.path.join(q['cwd'], os.path.expanduser(value)))
        canonical = os.path.join(os.path.realpath(os.path.dirname(value)), os.path.basename(value)) if lexical else os.path.realpath(value)
        if os.path.commonpath([root, canonical]) != root: raise ValueError('FS_SANDBOX_DENIED')
        return canonical
    def excluded(full, name):
        relative = os.path.relpath(full, root)
        return any(fnmatch.fnmatchcase(name, p) or fnmatch.fnmatchcase(relative, p) or fnmatch.fnmatchcase(relative + '/', p) for p in q.get('exclude', []) if isinstance(p, str))
    def listing(value):
        directory = checked(value); rows = []; truncated = False
        with os.scandir(directory) as entries:
            for entry in entries:
                if excluded(entry.path, entry.name): continue
                if len(rows) >= 2000: truncated = True; break
                is_link = entry.is_symlink(); broken = False
                try: is_dir = entry.is_dir(); broken = is_link and not os.path.exists(entry.path)
                except OSError: is_dir = False; broken = True
                rows.append(dict(name=entry.name, path=entry.path, isDir=is_dir, isSymlink=is_link, hidden=entry.name.startswith('.'), broken=broken))
        rows.sort(key=lambda row: (not row['isDir'], row['name'].lower(), row['name']))
        return dict(path=directory, entries=rows, truncated=truncated)
    if op == 'fs.watch':
        if not isinstance(q.get('paths'),list) or len(q['paths'])>64: raise ValueError('Invalid watch batch')
        versions=[]
        for value in q['paths']:
            try: versions.append(dict(version=version(checked(value))))
            except Exception as error: versions.append(dict(version=None,error=str(error)))
        return dict(versions=versions)
    if op == 'fs.trees':
        paths = q.get('paths')
        if not isinstance(paths, list) or not 0 < len(paths) <= 64: raise ValueError('Invalid directory batch')
        levels = []
        for item in paths:
            try: levels.append(listing(item))
            except Exception as error: levels.append(dict(path=item, entries=[], truncated=False, error=str(error)))
        return dict(levels=levels)
    if op == 'fs.tree': return listing(path)
    if op == 'fs.search':
        query = q.get('query', ''); matches = []; dirs = []; visited = 0; truncated = False
        if not isinstance(query, str) or len(query) > 4096: raise ValueError('Invalid query')
        if query.startswith(('/', '~/', './', '../')):
            target = checked(query)
            return dict(matches=[target] if os.path.exists(target) else [], dirs=[target] if os.path.isdir(target) else [], truncated=False)
        for directory, directories, files in os.walk(checked(q['cwd']), followlinks=False):
            directories[:] = sorted(d for d in directories if d not in ('.git','node_modules','__pycache__') and not excluded(os.path.join(directory,d),d))
            for name in directories + sorted(files):
                visited += 1; full = os.path.join(directory, name); relative = os.path.relpath(full,q['cwd'])
                if visited > 10000 or len(matches) >= 200: truncated = True; break
                if excluded(full,name): continue
                if query.lower().replace('\\','/') in (relative if '/' in query or '\\' in query else name).lower():
                    matches.append(relative)
                    if name in directories: dirs.append(relative)
            if truncated: break
        return dict(matches=matches, dirs=dirs, truncated=truncated)
    path = checked(path, op in ('fs.rename','fs.remove'))
    if op in ('fs.read','fs.readPage','fs.file','fs.html'):
        info = os.stat(path)
        if not stat.S_ISREG(info.st_mode): raise ValueError('FS_NOT_REGULAR_FILE')
        meta = dict(size=info.st_size, mtimeMs=info.st_mtime_ns / 1000000)
        if op == 'fs.readPage':
            offset = q.get('offset',0)
            if not isinstance(offset,int) or offset < 0: raise ValueError('Invalid offset')
            with open(path,'rb') as file:
                file.seek(offset); data = file.read(131072)
            if offset + len(data) < info.st_size and b'\n' in data: data = data[:data.rfind(b'\n')+1]
            end = min(offset+len(data),info.st_size)
            # Leave an incomplete UTF-8 character for the following page.
            decoder = __import__('codecs').getincrementaldecoder('utf-8')('strict')
            text = decoder.decode(data, final=end >= info.st_size); tail = decoder.getstate()[0]
            return dict(kind='text',text=text,offset=offset,nextOffset=end-len(tail),eof=end>=info.st_size,encoding='utf8',**meta)
        limit = 16777216 if op in ('fs.file','fs.html') else 5242880
        with open(path,'rb') as file: data = file.read(limit+1 if info.st_size<=limit else 4096)
        if op in ('fs.file','fs.html'):
            if info.st_size > limit: raise ValueError('FS_TOO_LARGE')
            return dict(data=base64.b64encode(data).decode())
        head = base64.b64encode(data[:4096]).decode()
        if b'\x00' in data[:4096]: return dict(kind='binary',head=head,**meta)
        try: content = data.decode('utf-8-sig')
        except UnicodeError: return dict(kind='binary',head=head,**meta)
        if info.st_size > limit: return dict(kind='too-large',head=head,**meta)
        return dict(kind='text',content=content.replace('\r\n','\n'),**meta)
    if q['mode'] == 'read-only': raise ValueError('FS_SANDBOX_DENIED')
    if op == 'fs.write':
        baseline = q.get('expectedMtimeMs'); info = describe(path)
        if baseline is not None and (not info or float(baseline) != os.stat(path).st_mtime_ns / 1000000): raise ValueError('FS_STALE_VERSION')
        content = q['content']
        if info:
            with open(path,'rb') as file: previous = file.read(5242881)
            if len(previous)>5242880 or b'\x00' in previous: raise ValueError('File is not an editable UTF-8 document')
            previous.decode('utf-8-sig')
            if b'\r\n' in previous: content = content.replace('\r\n','\n').replace('\n','\r\n')
            if previous.startswith(b'\xef\xbb\xbf'): content = '\ufeff' + content.lstrip('\ufeff')
        expected = dict(kind='replaceIfVersion',version=info['version']) if info else dict(kind='createIfAbsent')
        main(dict(action='write',path=path,root=root,mode=q['mode'],content=content,expected=expected))
        return dict(ok=True,mtimeMs=os.stat(path).st_mtime_ns/1000000)
    if op in ('fs.mkdir','fs.createFile','fs.rename'):
        name = q.get('name')
        if not isinstance(name,str) or name in ('','.','..') or '/' in name or '\\' in name or '\x00' in name: raise ValueError('Invalid file name')
        destination = checked(os.path.join(os.path.dirname(path) if op=='fs.rename' else path,name),True)
        if os.path.lexists(destination): raise FileExistsError('Destination already exists')
        if op=='fs.mkdir': os.mkdir(destination)
        elif op=='fs.createFile':
            with open(destination,'xb'): pass
        else:
            if path==root: raise ValueError('Cannot rename workspace root')
            os.rename(path,destination)
        return dict(path=destination)
    if op == 'fs.remove':
        if path==root: raise ValueError('Cannot remove workspace root')
        if os.path.isdir(path) and not os.path.islink(path): shutil.rmtree(path)
        else: os.unlink(path)
        return dict(path=path)
    if op == 'fs.upload':
        relative = q.get('relativePath',''); segments = relative.replace('\\','/').split('/')
        if any(p in ('','.','..') for p in segments) or relative.startswith('/'): raise ValueError('Invalid upload path')
        destination = checked(os.path.join(checked(q['dir']),*segments)); data = base64.b64decode(q['data'],validate=True)
        os.makedirs(os.path.dirname(destination),exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix='.dsh-upload-',dir=os.path.dirname(destination))
        try:
            with os.fdopen(fd,'wb') as file: file.write(data); file.flush(); os.fsync(file.fileno())
            os.replace(temporary,destination)
        finally:
            if os.path.exists(temporary): os.unlink(temporary)
        return dict(path=destination,size=len(data))
    raise ValueError('Unsupported remote file operation: '+op)

def main(q):
    path = q['path']; action = q['action']
    if action == 'terminal-shells':
        import pwd
        if not sys.platform.startswith('linux'): raise ValueError('Interactive SSH terminals currently require Linux')
        default = pwd.getpwuid(os.getuid()).pw_shell
        shells, names = [], set()
        for candidate in [default, 'bash', 'zsh', 'fish', 'sh']:
            executable = shutil.which(candidate)
            if not executable: continue
            name = os.path.basename(executable)
            if name in names or name in ('nologin', 'false'): continue
            names.add(name); shells.append(dict(path=executable, name=name, args=['-i']))
        return dict(shells=shells)
    if action == 'sidebar': return sidebar(q)
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

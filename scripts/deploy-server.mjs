// Developer deployment over the user's already-trusted OpenSSH connection.
// No password arguments, private-key reads, or modifications to ~/.ssh/config.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {quote} from '../src/host/ssh.js';
import {installRuntime, RUNTIME_VERSION} from '../src/host/remote.js';
const run = promisify(execFile), alias = process.argv[2];
if (!alias || !/^[\w-]+$/.test(alias)) throw Error('Expected SSH alias');
const sshArgs = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15', alias];
const prepare = `import os,glob,subprocess,shutil,json,urllib.request,hashlib,base64,io,tarfile,pathlib
home=os.path.expanduser('~'); tools=os.path.join(home,'.dsh-ssh','tools'); bindir=os.path.join(tools,'bin')
nodes=[shutil.which('node'),os.path.join(bindir,'node')]+glob.glob(home+'/.vscode-server/cli/servers/*/server/node')+glob.glob(home+'/.vscode-server/bin/*/node')
selected=None
for path in nodes:
 if not path or not os.path.isfile(path): continue
 try:
  version=subprocess.check_output([path,'--version'],text=True,timeout=10).strip().lstrip('v'); parts=tuple(int(x) for x in version.split('.')[:2])
  if parts >= (22,12): selected=path; break
 except Exception: pass
if not selected: raise RuntimeError('需要 Node >=22.12.0；未发现系统或 VS Code Node')
os.makedirs(bindir,mode=0o700,exist_ok=True); target=os.path.join(bindir,'node')
if os.path.realpath(selected)!=os.path.realpath(target):
 shutil.copy2(selected,target+'.tmp'); os.chmod(target+'.tmp',0o700); os.replace(target+'.tmp',target)
version='11.13.0'; npm=os.path.join(tools,'npm-'+version); entry=os.path.join(npm,'package','bin','npm-cli.js')
if not os.path.isfile(entry):
 metadata=json.load(urllib.request.urlopen('https://registry.npmjs.org/npm/'+version,timeout=30))
 url=metadata['dist']['tarball']; integrity=metadata['dist']['integrity']
 if not url.startswith('https://registry.npmjs.org/npm/'): raise RuntimeError('Unexpected npm source')
 payload=urllib.request.urlopen(url,timeout=90).read(); actual='sha512-'+base64.b64encode(hashlib.sha512(payload).digest()).decode()
 if actual != integrity: raise RuntimeError('npm integrity mismatch')
 os.makedirs(npm,mode=0o700,exist_ok=True)
 with tarfile.open(fileobj=io.BytesIO(payload),mode='r:gz') as archive:
  for member in archive.getmembers():
   destination=os.path.abspath(os.path.join(npm,member.name))
   if os.path.commonpath([os.path.abspath(npm),destination])!=os.path.abspath(npm) or member.issym() or member.islnk() or not (member.isfile() or member.isdir()): raise RuntimeError('Unsafe npm archive')
  archive.extractall(npm)
launcher=os.path.join(bindir,'npm')
with open(launcher+'.tmp','w') as file: file.write('#!/bin/sh\\nexec '+json.dumps(target)+' '+json.dumps(entry)+' "$@"\\n')
os.chmod(launcher+'.tmp',0o700); os.replace(launcher+'.tmp',launcher)
print(json.dumps(dict(nodePath=target,nodeVersion=subprocess.check_output([target,'--version'],text=True).strip(),npmPath=launcher,npmVersion=version)))`;
const prepared = await run('ssh', [...sshArgs, 'python3 -c ' + quote(prepare)], {timeout: 180000, maxBuffer: 16384});
const result = JSON.parse(prepared.stdout.trim().split(/\r?\n/).at(-1));
console.log('Prepared user-owned Node/npm:', JSON.stringify(result));
const prefix = result.nodePath.slice(0, result.nodePath.lastIndexOf('/'));
const script = `(${installRuntime.toString()})(${JSON.stringify(RUNTIME_VERSION)})`;
const command = `PATH=${quote(prefix)}:"$PATH" ${quote(result.nodePath)} -e ${quote(script)}`;
const installed = await run('ssh', [...sshArgs, command], {timeout: 650000, maxBuffer: 32768});
if (!installed.stdout.includes('DSH_SSH_JSON:')) throw Error('Missing remote installation result');
console.log(installed.stdout.trim());
await mkdir(join(import.meta.dirname, '../artifacts'), {recursive: true});
await writeFile(join(import.meta.dirname, '../artifacts/server-deployment.json'), JSON.stringify({alias, ...result, runtimeVersion: RUNTIME_VERSION, installed: true}, null, 2));

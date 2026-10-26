import {execFileSync} from 'node:child_process';
const alias = process.argv[2]; if (!alias || !/^[\w-]+$/.test(alias)) throw Error('Expected SSH alias');
const code = `import os,sys,json,glob,shutil,platform,urllib.request
home=os.path.expanduser('~')
result=dict(home=home,system=platform.platform(),node=shutil.which('node'),npm=shutil.which('npm'),python=sys.version.split()[0],vscodeNodes=glob.glob(home+'/.vscode-server/cli/servers/*/server/node')+glob.glob(home+'/.vscode-server/bin/*/node'),freeMiB=shutil.disk_usage(home).free//1048576)
try:
 result['registryStatus']=urllib.request.urlopen('https://registry.npmjs.org/@deepseek-ai%2Fdsh/0.2.1-rc.3',timeout=8).status
except Exception as error: result['registryError']=str(error)
print(json.dumps(result))`;
const command = "python3 -c '" + code.replaceAll("'", "'\\''") + "'";
const result = execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'StrictHostKeyChecking=yes', alias, command], {encoding: 'utf8', timeout: 35000});
console.log(JSON.stringify(JSON.parse(result.trim().split(/\r?\n/).at(-1)), null, 2));

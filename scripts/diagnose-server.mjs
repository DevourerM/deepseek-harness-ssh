import {join} from 'node:path';
import {ConfigStore} from '../src/host/config.js';
import {SshConnector, exec, nodeCommand} from '../src/host/ssh.js';
const store = new ConfigStore(join(import.meta.dirname, '../artifacts/real-server'));
const connector = new SshConnector(store), alias = process.argv[2], c = await connector.connect(alias);
try {
  const result = await exec(c, nodeCommand(c.host, async () => {
    const {homedir} = await import('node:os'), {join, dirname} = await import('node:path'), {createHash} = await import('node:crypto'), {spawn} = await import('node:child_process');
    const folder = join(homedir(), '.dsh-ssh/validation/workspace'), key = createHash('sha256').update(folder).digest('hex').slice(0, 24);
    const home = join(homedir(), '.dsh-ssh/workspaces', key), cli = join(homedir(), '.dsh-ssh/runtime/0.2.1-rc.3/node_modules/@deepseek-ai/dsh/lib/bin.js');
    const child = spawn(process.execPath, [cli, '--profile', 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'], {env: {...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH, DSH_HOME: home}, cwd: folder, stdio: ['ignore', 'pipe', 'pipe'], detached: true});
    const show = data => process.stdout.write(data.toString().replace(/([?&]token=)[^\s]+/g, '$1[REDACTED]'));
    child.stdout.on('data', show); child.stderr.on('data', show);
    const timer = setTimeout(() => { console.log('DIAGNOSTIC_TIMEOUT'); try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 35000);
    child.once('exit', code => { clearTimeout(timer); console.log('EXIT_CODE=' + code); });
  }), {timeout: 45000}); console.log(result.stdout);
} finally { c.close(); connector.dispose(); }

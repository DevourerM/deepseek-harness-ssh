import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {sshFixture, decodeCommand} from './ssh-fixture.mjs';
import {prepareHome, startHost} from '../scripts/host-fixture.mjs';
import {root as pluginRoot} from '../scripts/env.mjs';

// Windows test substitute for the POSIX bootstrap only. The SSH, SFTP, TCP
// forwarding, DSH Host, browser authentication and file UI are real.
export async function integratedSsh(root, artifacts) {
  await mkdir(root, {recursive: true});
  const homes = new Map(), running = new Set();
  const server = await sshFixture(root, {onExec: async (command, stream) => {
    try {
      const {script} = decodeCommand(command);
      const args = JSON.parse(Buffer.from(script.match(/\.\.\.JSON.parse\(Buffer.from\('([^']+)','base64'/)[1], 'base64').toString());
      if (script.startsWith('(async function runtimeInfo')) {
        stream.write('DSH_SSH_JSON:' + JSON.stringify({platform: 'linux', node: '24.17.0', installed: true, installedVersion: '0.2.1-rc.3', requiredVersion: '0.2.1-rc.3'})); stream.exit(0); stream.end();
      } else if (script.startsWith('(async function launchHost')) {
        const [, path, alias, localPort] = args, folder = resolve(root, '.' + path);
        let home = homes.get(path); if (!home) { home = await mkdtemp(join(artifacts, 'remote-home-')); homes.set(path, home); }
        await prepareHome(home, {plugin: false, folder, alias, extraPatch: '- id: agent-default-model\n  config:\n    provider: ssh-fixture\n    model: test\n- insert:\n    - id: ssh-remote-model-test\n      name: ' + JSON.stringify(join(pluginRoot, 'scripts/remote-model-fixture.mjs').replaceAll('\\', '/')) + '\n'});
        let closed = false, host;
        const stop = () => { closed = true; if (host) host.stop().finally(() => { running.delete(host); stream.exit(0); stream.end(); }); };
        stream.once('end', stop); stream.once('close', stop);
        host = await startHost(home, {folder, trustedPort: localPort}); running.add(host);
        await writeFile(join(artifacts, 'remote-host.log'), host.log);
        if (closed) { await host.stop(); running.delete(host); return; }
        stream.write('dsh web: ' + host.url + '\n');
        host.child.once('exit', code => { running.delete(host); stream.exit(code || 0); stream.end(); });
      } else { stream.stderr.write('Unsupported fixture operation'); stream.exit(1); stream.end(); }
    } catch (e) { stream.stderr.write(e.message); stream.exit(1); stream.end(); }
  }});
  return {...server, close: async () => { await Promise.all([...running].map(h => h.stop())); await server.close(); }};
}

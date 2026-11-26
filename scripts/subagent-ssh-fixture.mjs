import {generateKeyPairSync} from 'node:crypto';
import {mkdir, mkdtemp, readFile, readdir, stat, writeFile} from 'node:fs/promises';
import {join, posix} from 'node:path';
import ssh2 from 'ssh2';
import {sshFixture} from '../test/ssh-fixture.mjs';
import {ConfigStore} from '../src/host/config.js';
import {fingerprintOf} from '../src/host/ssh.js';

// Model the remote file worker's wire protocol over real SSH/SFTP. Test files
// live under a temp directory, separate from the DSH workspace identity.
export async function startSubagentSshFixture(home) {
  const storage = await mkdtemp(join(home, 'remote-'));
  const folder = '/fixture';
  const localPath = path => {
    if (typeof path !== 'string' || !posix.isAbsolute(path) || /[\\:]/.test(path)) throw Error('Invalid fixture path');
    return join(storage, posix.normalize(path));
  };
  const identity = join(home, 'fixture-key');
  const {privateKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
  const key = privateKey.export({type: 'pkcs1', format: 'pem'});
  await writeFile(identity, key);
  const call = async q => {
    const file = localPath(q.path);
    if (q.action === 'resolve') return {path: posix.normalize(q.path)};
    if (q.action === 'stat') {
      const info = await stat(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
      return info ? {type: info.isDirectory() ? 'directory' : 'file', size: info.size, version: String(info.mtimeMs)} : null;
    }
    if (q.action === 'read') return {data: (await readFile(file)).toString('base64')};
    if (q.action === 'write') {
      const rel = posix.relative(q.root, q.path);
      if (q.mode === 'read-only' || (q.mode !== 'danger-full-access' && (rel === '..' || rel.startsWith('../')))) throw Error('FS_SANDBOX_DENIED');
      await writeFile(file, q.content, {flag: 'wx'});
      return {before: null, after: q.content, operation: 'create', version: String((await stat(file)).mtimeMs)};
    }
    if (q.action === 'glob' || q.action === 'grep') {
      const results = [];
      for (const name of await readdir(file)) {
        if (q.action === 'glob' && name === q.pattern) results.push(posix.join(q.path, name));
        if (q.action === 'grep' && name === q.include) {
          const line = (await readFile(join(file, name), 'utf8')).trimEnd();
          if (line.includes(q.pattern)) results.push({path: posix.join(q.path, name), line, lineNumber: 1});
        }
      }
      return {results, truncated: false};
    }
    throw Error('Unexpected worker action: ' + q.action);
  };
  const server = await sshFixture(storage, {
    authorizedKey: ssh2.utils.parseKey(key).getPublicSSH(),
    onExec(command, channel) {
      const chunks = [];
      channel.on('data', chunk => chunks.push(chunk));
      channel.once('end', async () => {
        let reply;
        try {
          if (!command.startsWith("python3 -c 'import base64;exec(")) throw Error('Unexpected SSH exec');
          reply = {ok: true, value: await call(JSON.parse(Buffer.concat(chunks)))};
        } catch (error) {
          reply = {ok: false, code: error.code === 'ENOENT' ? 'FS_NOT_FOUND' : error.message === 'FS_SANDBOX_DENIED' ? error.message : 'FS_IO_ERROR', message: error.message};
        }
        channel.exit(0);
        channel.end(JSON.stringify(reply));
      });
    },
  });
  const store = new ConfigStore(join(home, 'ssh-config'));
  const alias = 'fixture';
  try {
    await store.init();
    await store.save(`Host ${alias}\n HostName 127.0.0.1\n Port ${server.port}\n User tester\n IdentityFile "${identity.replaceAll('\\', '/')}"\n IdentityAgent none\n`, (await store.get()).revision);
    await store.pin(`[127.0.0.1]:${server.port}`, fingerprintOf(ssh2.utils.parseKey(server.key).getPublicSSH()));
    return {store, alias, folder, makeDirs: dirs => Promise.all(dirs.map(dir => mkdir(localPath(folder + dir), {recursive: true}))), close: server.close};
  } catch (error) {
    await server.close();
    throw error;
  }
}

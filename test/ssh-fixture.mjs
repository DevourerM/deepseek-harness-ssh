import ssh2 from 'ssh2';
import {generateKeyPairSync} from 'node:crypto';
import {stat, readdir, realpath, readFile} from 'node:fs/promises';
import {join, relative, resolve, sep} from 'node:path';
import {connect as tcpConnect} from 'node:net';

// Real encrypted SSH/SFTP server on loopback. Virtual POSIX paths map to a temporary directory.
export async function sshFixture(root, {onExec, password = 'test-password', hostKey, authorizedKey, keyboardOnly = false, interactivePrompt = 'Password: '} = {}) {
  const key = hostKey || generateKeyPairSync('rsa', {modulusLength: 2048}).privateKey.export({format: 'pem', type: 'pkcs1'});
  const connections = new Set(), processes = new Set(), forwards = new Set(), answers = []; let execCount = 0;
  const server = new ssh2.Server({hostKeys: [key]}, client => {
    connections.add(client); client.on('error', () => {}); client.once('close', () => connections.delete(client));
    client.on('authentication', ctx => {
      if (keyboardOnly) {
        if (ctx.method !== 'keyboard-interactive') return ctx.reject(['keyboard-interactive']);
        return ctx.prompt([{prompt: interactivePrompt, echo: false}], response => { answers.push(response); if (response[0] === password) ctx.accept(); else ctx.reject(['keyboard-interactive']); });
      }
      if (ctx.username === 'tester' && ctx.method === 'password' && ctx.password === password) return ctx.accept();
      if (ctx.username === 'tester' && ctx.method === 'publickey' && authorizedKey && ctx.key.data.equals(authorizedKey)) {
        const parsed = ssh2.utils.parseKey(ctx.key.data);
        if (!ctx.signature || parsed.verify(ctx.blob, ctx.signature, ctx.hashAlgo) === true) return ctx.accept();
      }
      ctx.reject(['publickey', 'password']);
    });
    client.on('ready', () => {
      client.on('session', accept => {
        const session = accept();
        session.on('exec', (accept, reject, info) => {
          execCount++; const stream = accept(); stream.on('error', () => {});
          if (onExec) onExec(info.command, stream, processes);
          else { stream.write('SSH_FIXTURE_OK'); stream.exit(0); stream.end(); }
        });
        session.on('sftp', accept => {
          const sftp = accept(), handles = new Map(); let next = 1;
          const status = (id, code = 4, message = 'Fixture I/O error') => sftp.status(id, code, message);
          const local = path => {
            const posix = Buffer.isBuffer(path) ? path.toString() : path;
            const suffix = posix === '.' || posix === '~' || posix === '/' ? '' : posix.replace(/^\//, '');
            const result = resolve(root, suffix), rel = relative(root, result);
            if (rel === '..' || rel.startsWith('..' + sep) || rel.includes(':')) throw Error('outside fixture');
            return result;
          };
          const attrs = s => ({mode: s.mode, uid: 0, gid: 0, size: s.size, atime: Math.floor(s.atimeMs / 1000), mtime: Math.floor(s.mtimeMs / 1000)});
          const guard = (id, fn) => Promise.resolve().then(fn).catch(e => status(id, e.code === 'ENOENT' ? 2 : 4, e.message));
          sftp.on('REALPATH', (id, path) => guard(id, async () => { const canonical = await realpath(local(path)); sftp.name(id, [{filename: '/' + relative(root, canonical).split(sep).join('/'), longname: '', attrs: {}}]); }));
          for (const event of ['STAT', 'LSTAT']) sftp.on(event, (id, path) => guard(id, async () => sftp.attrs(id, attrs(await stat(local(path))))));
          sftp.on('OPENDIR', (id, path) => guard(id, async () => {
            const folder = local(path), entries = [];
            for (const name of await readdir(folder)) entries.push({filename: name, longname: name, attrs: attrs(await stat(join(folder, name)))});
            const handle = Buffer.alloc(4); handle.writeUInt32BE(next++); handles.set(handle.toString('hex'), entries); sftp.handle(id, handle);
          }));
          sftp.on('READDIR', (id, handle) => { const entries = handles.get(handle.toString('hex')); if (!entries) return status(id, 4); if (!entries.length) return status(id, 1); sftp.name(id, entries.splice(0, 100)); });
          sftp.on('CLOSE', (id, handle) => { handles.delete(handle.toString('hex')); status(id, 0); });
          sftp.on('error', () => {});
        });
      });
      client.on('tcpip', (accept, reject, info) => {
        if (info.destIP !== '127.0.0.1' && info.destIP !== 'localhost') { reject(); return; }
        const socket = tcpConnect(info.destPort, '127.0.0.1'); forwards.add(socket);
        socket.once('close', () => forwards.delete(socket)); socket.on('error', () => { try { reject(); } catch {} });
        socket.once('connect', () => { const channel = accept(); channel.on('error', () => socket.destroy()); channel.once('close', () => socket.destroy()); socket.once('close', () => channel.destroy()); socket.pipe(channel).pipe(socket); });
      });
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {port: server.address().port, key, connections, processes, answers, get execCount() { return execCount; },
    drop: () => { for (const c of connections) c.end(); },
    close: async () => { for (const p of processes) p.kill(); for (const socket of forwards) socket.destroy(); for (const c of connections) c.end(); await new Promise(resolve => server.close(resolve)); }};
}
export function decodeCommand(command) {
  // Production passes two POSIX-quoted arguments: executable and -e script.
  const match = command.match(/^'((?:[^']|'\\'')*)' -e '([\s\S]*)'$/);
  if (!match) throw Error('Unexpected fixture command');
  return {node: match[1].replaceAll("'\\''", "'"), script: match[2].replaceAll("'\\''", "'")};
}

import ssh2 from 'ssh2';
import {createHash, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {SshError, localPath} from './config.js';

export const fingerprintOf = key => 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
export const endpointOf = host => `[${host.hostname}]:${host.port}`;
function authenticationError(host, secret, kind = 'password', failed = false) {
  const label = kind === 'passphrase' ? '私钥口令' : '登录密码';
  return new SshError(failed ? `${host.alias} 的${label}验证失败，请重新输入` : `${host.alias} 需要输入${label}`, failed ? 'SSH_AUTH_FAILED' : 'SSH_AUTH_REQUIRED',
    {alias: host.alias, username: host.username, hostname: host.hostname, kind});
}
export const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
export function nodeCommand(host, fn, args = []) {
  const script = `(${fn.toString()})(...JSON.parse(Buffer.from('${Buffer.from(JSON.stringify(args)).toString('base64')}','base64').toString('utf8')))`;
  return `${quote(host.nodePath)} -e ${quote(script)}`;
}
export function call(target, method, ...args) { return new Promise((resolve, reject) => target[method](...args, (error, value) => error ? reject(error) : resolve(value))); }
export class SshConnector {
  challenges = new Map(); active = new Set(); disposed = false;
  constructor(store) { this.store = store; }
  trust(challengeId) {
    const entry = this.challenges.get(challengeId); this.challenges.delete(challengeId);
    if (!entry || entry.expires < Date.now()) throw new SshError('指纹确认已过期，请重新检查连接', 'TRUST_EXPIRED');
    return this.store.pin(entry.endpoint, entry.fingerprint);
  }
  async connect(alias, secrets = {}, signal) {
    if (this.disposed) throw new SshError('SSH 插件已停止', 'DISPOSED');
    const clients = []; const host = await this.store.host(alias); let closed = false;
    const close = () => { if (closed) return; closed = true; for (const c of clients.reverse()) { this.active.delete(c); c.destroy(); } };
    const abort = () => close(); signal?.throwIfAborted(); signal?.addEventListener('abort', abort, {once: true});
    try {
      const chain = []; let h = host;
      while (h) { chain.unshift(h); h = h.proxyJump ? await this.store.host(h.proxyJump) : null; }
      let previous;
      for (const item of chain) {
        signal?.throwIfAborted();
        const sock = previous ? await call(previous, 'forwardOut', '127.0.0.1', 0, item.hostname, item.port) : undefined;
        const client = new ssh2.Client(); client.on('error', () => {}); clients.push(client); this.active.add(client);
        const known = await this.store.known(), endpoint = endpointOf(item), secret = secrets[item.alias] ?? {};
        let verification, interactiveError, keyboardUsed = false;
        const privateKey = item.identityFile ? await readFile(localPath(item.identityFile)) : undefined;
        const agent = item.identityAgent === 'none' ? undefined : item.identityAgent === 'default' ? (process.env.SSH_AUTH_SOCK || (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : undefined)) : localPath(item.identityAgent);
        await new Promise((resolve, reject) => {
          let ready = false;
          client.on('error', error => { if (!ready) reject(verification || interactiveError || (error.level === 'client-authentication' ? authenticationError(item, secret, 'password', !!secret.password) : new SshError(`SSH ${item.alias}：${error.message}`, 'SSH_CONNECT'))); });
          client.once('close', () => { if (!ready) reject(verification || new SshError('SSH 连接在就绪前关闭', 'SSH_CLOSED')); });
          client.once('ready', () => { ready = true; resolve(); });
          client.on('keyboard-interactive', (_name, _instructions, _language, prompts, finish) => {
            if (!prompts.length) { finish([]); return; }
            if (prompts.length === 1 && prompts[0].echo === false && /password|密码|口令/i.test(prompts[0].prompt)
              && !/one[\s-]*time|otp|verification|token|passcode|2fa|mfa|验证码|动态|一次性|安全码/i.test(prompts[0].prompt)) {
              if (typeof secret.password === 'string' && secret.password && !keyboardUsed) { keyboardUsed = true; finish([secret.password]); return; }
              interactiveError = authenticationError(item, secret, 'password', keyboardUsed); finish([]); return;
            }
            interactiveError = new SshError('服务器要求额外的交互验证（例如验证码）；请先使用私钥，或向管理员确认认证方式。不会把登录密码填入验证码提示。', 'SSH_INTERACTIVE_UNSUPPORTED', {alias: item.alias});
            finish([]);
          });
          try { client.connect({host: item.hostname, port: item.port, username: item.username, sock,
            privateKey, passphrase: secret.passphrase, password: secret.password, agent,
            tryKeyboard: true, agentForward: false, readyTimeout: item.timeout,
            keepaliveInterval: item.keepalive, keepaliveCountMax: 3,
            hostVerifier: key => {
              const fingerprint = fingerprintOf(key);
              if (known[endpoint] === fingerprint) return true;
              if (known[endpoint]) verification = new SshError('远端主机指纹与已保存值不符，连接已阻止', 'HOST_KEY_CHANGED', {alias: item.alias, endpoint, expected: known[endpoint], fingerprint});
              else {
                for (const [id, c] of this.challenges) if (c.expires < Date.now()) this.challenges.delete(id);
                const challengeId = randomUUID();
                if (this.challenges.size >= 100) this.challenges.delete(this.challenges.keys().next().value);
                this.challenges.set(challengeId, {endpoint, fingerprint, expires: Date.now() + 120000});
                verification = new SshError('首次连接：请通过可信渠道核对服务器指纹后确认', 'HOST_KEY_UNKNOWN', {alias: item.alias, endpoint, fingerprint, challengeId});
              }
              return false;
            }}); } catch (error) {
              if (privateKey && /passphrase|decrypt|encrypted|bad password/i.test(error.message)) reject(authenticationError(item, secret, 'passphrase', !!secret.passphrase));
              else reject(error);
            }
        });
        previous = client;
      }
      signal?.throwIfAborted();
      return {client: previous, host, close: () => { signal?.removeEventListener('abort', abort); close(); }};
    } catch (e) { signal?.removeEventListener('abort', abort); close(); throw e; }
  }
  dispose() { this.disposed = true; for (const client of this.active) client.destroy(); this.active.clear(); this.challenges.clear(); }
}
export async function exec(connection, command, {timeout = 20000, maxBytes = 1024 * 1024, signal, stdin} = {}) {
  signal?.throwIfAborted();
  const stream = await call(connection.client, 'exec', command);
  return new Promise((resolve, reject) => {
    let out = '', err = '', bytes = 0, settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(result); };
    const stop = error => { stream.close(); finish(error); };
    const abort = () => stop(signal.reason || new SshError('操作已取消', 'CANCELLED'));
    const timer = setTimeout(() => stop(new SshError('远端操作超时', 'REMOTE_TIMEOUT')), timeout);
    signal?.addEventListener('abort', abort, {once: true});
    const receive = (data, stderr) => {
      bytes += data.length;
      if (bytes > maxBytes) { stop(new SshError('远端输出超过限制', 'OUTPUT_LIMIT')); return; }
      if (stderr) err += data.toString('utf8'); else out += data.toString('utf8');
    };
    stream.on('data', data => receive(data, false)); stream.stderr.on('data', data => receive(data, true));
    stream.on('error', error => finish(error));
    stream.on('close', (code, exitSignal) => {
      if (code !== 0) finish(new SshError(`远端命令失败 (${code ?? exitSignal ?? '连接断开'})：${err.slice(-2000)}`, 'REMOTE_COMMAND'));
      else finish(null, {stdout: out, stderr: err});
    });
    if (stdin !== undefined) stream.end(stdin);
    if (signal?.aborted) abort();
  });
}
export async function browse(connection, path = '.', {signal, timeout = 15000} = {}) {
  if (typeof path !== 'string' || !path || path.length > 4096 || /[\x00-\x1f\x7f]/.test(path)) throw new SshError('远程目录无效', 'PATH_INVALID');
  let sftp, timer;
  const abort = () => sftp?.destroy();
  try {
    signal?.throwIfAborted(); signal?.addEventListener('abort', abort, {once: true});
    return await Promise.race([(async () => {
      sftp = await call(connection.client, 'sftp'); signal?.throwIfAborted();
      const canonical = await call(sftp, 'realpath', path === '~' ? '.' : path.startsWith('~/') ? (await call(sftp, 'realpath', '.')) + path.slice(1) : path);
      if (!canonical.startsWith('/')) throw new SshError('首版只支持 POSIX 远端目录（Linux/macOS）', 'PLATFORM_UNSUPPORTED');
      const attrs = await call(sftp, 'stat', canonical);
      if (!attrs.isDirectory()) throw new SshError('请选择目录', 'NOT_DIRECTORY');
      const entries = await call(sftp, 'readdir', canonical);
      const directories = entries.filter(e => e.filename !== '.' && e.filename !== '..' && (e.attrs.isDirectory() || e.attrs.isSymbolicLink()))
        .map(e => ({name: e.filename, symlink: e.attrs.isSymbolicLink()})).sort((a, b) => a.name.localeCompare(b.name));
      return {path: canonical, directories: directories.slice(0, 2000), truncated: directories.length > 2000};
    })(), new Promise((_, reject) => { timer = setTimeout(() => reject(new SshError('SFTP 操作超时', 'SFTP_TIMEOUT')), timeout); })]);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); sftp?.end(); }
}
export async function forward(connection) {
  const sockets = new Set(); let remotePort;
  const server = createServer(socket => {
    sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket));
    if (!remotePort) { socket.destroy(); return; }
    connection.client.forwardOut('127.0.0.1', socket.remotePort || 0, '127.0.0.1', remotePort, (error, stream) => {
      if (error || socket.destroyed) { stream?.destroy(); socket.destroy(); return; }
      stream.on('error', () => socket.destroy()); socket.once('close', () => stream.destroy()); stream.once('close', () => socket.destroy());
      socket.pipe(stream).pipe(socket);
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {port: server.address().port, setRemote: port => { remotePort = port; }, close: () => { for (const socket of sockets) socket.destroy(); server.close(); }};
}

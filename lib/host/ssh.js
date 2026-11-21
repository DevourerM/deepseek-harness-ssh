import ssh2 from 'ssh2';
import {createHash, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createServer, createConnection} from 'node:net';
import {SshError, localPath} from './config.js';
import {openSession, setClientLimit} from './channels.js';
export {openSession} from './channels.js';

const OTP_PROMPT = /2nd|second|one[\s-]*time|otp|totp|verification|token|passcode|2fa|mfa|验证码|动态|一次性|安全码|令牌/i;
const PASSWORD_PROMPT = /password|passphrase|密码|口令/i;
const isOtpPrompt = text => OTP_PROMPT.test(text || '');
const isPasswordPrompt = text => PASSWORD_PROMPT.test(text || '') && !isOtpPrompt(text);

function connectTcp(host, port, timeout, alias, signal) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const socket = createConnection({host, port});
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (err) { socket.destroy(); reject(err); } else resolve(value);
    };
    const onAbort = () => finish(signal.reason || new SshError('操作已取消', 'CANCELLED'));
    const timer = setTimeout(() => finish(new SshError(`SSH ${alias}：连接超时 (${Math.round(timeout / 1000)}s)`, 'SSH_CONNECT')), timeout);
    socket.once('connect', () => finish(null, socket));
    socket.once('error', err => finish(new SshError(`SSH ${alias}：${err.message}`, 'SSH_CONNECT')));
    signal?.addEventListener('abort', onAbort, {once: true});
  });
}

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
export function call(target, method, ...args) {
  if (method === 'exec' || method === 'sftp') return openSession(target, method, args, {kind: method === 'exec' ? 'persistent' : 'normal'});
  return new Promise((resolve, reject) => target[method](...args, (error, value) => error ? reject(error) : resolve(value)));
}
export class SshConnector {
  challenges = new Map(); active = new Set(); disposed = false;
  constructor(store) { this.store = store; }
  trust(challengeId) {
    const entry = this.challenges.get(challengeId); this.challenges.delete(challengeId);
    if (!entry || entry.expires < Date.now()) throw new SshError('指纹确认已过期，请重新检查连接', 'TRUST_EXPIRED');
    return this.store.pin(entry.endpoint, entry.fingerprint);
  }
  async connect(alias, secrets = {}, signal, {onChallenge} = {}) {
    if (this.disposed) throw new SshError('SSH 插件已停止', 'DISPOSED');
    const clients = [], sockets = []; const host = await this.store.host(alias); let closed = false;
    const close = () => {
      if (closed) return; closed = true;
      for (const c of clients.reverse()) { this.active.delete(c); c.destroy(); }
      for (const s of sockets.reverse()) s.destroy();
    };
    const abort = () => close(); signal?.throwIfAborted(); signal?.addEventListener('abort', abort, {once: true});
    try {
      const chain = []; let h = host;
      while (h) { chain.unshift(h); h = h.proxyJump ? await this.store.host(h.proxyJump) : null; }
      let previous;
      for (const item of chain) {
        signal?.throwIfAborted();
        const sock = previous
          ? await call(previous, 'forwardOut', '127.0.0.1', 0, item.hostname, item.port)
          : await connectTcp(item.hostname, item.port, item.timeout, item.alias, signal);
        if (!previous && sock) sockets.push(sock);
        const client = new ssh2.Client(); client.on('error', () => {}); clients.push(client); this.active.add(client);
        const known = await this.store.known(), endpoint = endpointOf(item), secret = secrets[item.alias] ?? {};
        let verification, interactiveError;
        const used = {password: false, otp: false};
        let probed = false, keyboardAttempted = false, passwordAttempted = false, partialAuthed = false;
        const tried = new Set();
        const privateKey = item.identityFile ? await readFile(localPath(item.identityFile)) : undefined;
        const agent = item.identityAgent === 'none' ? undefined : item.identityAgent === 'default' ? (process.env.SSH_AUTH_SOCK || (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : undefined)) : localPath(item.identityAgent);
        await new Promise((resolve, reject) => {
          let ready = false;
          const fail = error => {
            if (ready) return;
            const failed = !!(secret.password || used.password || used.otp);
            reject(verification || interactiveError || (error.level === 'client-authentication' ? authenticationError(item, secret, 'password', failed) : new SshError(`SSH ${item.alias}：${error.message}`, 'SSH_CONNECT')));
          };
          client.on('error', fail);
          client.once('close', () => { if (!ready) reject(verification || interactiveError || new SshError('SSH 连接在就绪前关闭', 'SSH_CLOSED')); });
          client.once('ready', () => { ready = true; setClientLimit(client, item.maxSessions); resolve(); });
          client.on('keyboard-interactive', async (name, instructions, _language, prompts, finish) => {
            if (ready || closed) { finish([]); return; }
            if (!prompts.length) { finish([]); return; }
            const answers = new Array(prompts.length), missing = [];
            for (let i = 0; i < prompts.length; i++) {
              const p = prompts[i];
              if (isPasswordPrompt(p.prompt) && typeof secret.password === 'string' && secret.password && !used.password) {
                used.password = true; answers[i] = secret.password;
              } else if (isOtpPrompt(p.prompt) && typeof secret.otp === 'string' && secret.otp && !used.otp) {
                used.otp = true; answers[i] = secret.otp;
              } else {
                missing.push(i);
              }
            }
            if (!missing.length) { finish(answers); return; }
            if (!onChallenge) {
              if (prompts.length === 1 && prompts[0].echo === false && isPasswordPrompt(prompts[0].prompt)) {
                interactiveError = authenticationError(item, secret, 'password', used.password);
              } else {
                interactiveError = new SshError('服务器要求额外的交互验证（例如验证码）；请先使用私钥，或向管理员确认认证方式。不会把登录密码填入验证码提示。', 'SSH_INTERACTIVE_UNSUPPORTED', {alias: item.alias});
              }
              finish([]); return;
            }
            try {
              const supplied = await onChallenge({
                kind: 'keyboard-interactive',
                alias: item.alias, username: item.username, hostname: item.hostname,
                name: name || '', instructions: instructions || '',
                prompts: missing.map(i => ({prompt: prompts[i].prompt, echo: !!prompts[i].echo}))
              });
              if (!Array.isArray(supplied) || supplied.length !== missing.length) throw new SshError('交互认证输入无效', 'SSH_AUTH_FAILED');
              missing.forEach((idx, k) => {
                const value = String(supplied[k] ?? '');
                answers[idx] = value;
                if (isPasswordPrompt(prompts[idx].prompt)) used.password = true;
                if (isOtpPrompt(prompts[idx].prompt)) used.otp = true;
              });
              finish(answers);
            } catch (error) {
              interactiveError = error instanceof SshError ? error : new SshError(error?.message || '已取消 SSH 认证', error?.code || 'CANCELLED');
              finish([]);
            }
          });
          const authHandler = (authsLeft, partialSuccess, cb) => {
            if (!probed && authsLeft === null) { probed = true; return 'none'; }
            if (partialSuccess) {
              partialAuthed = true;
              tried.delete('keyboard-interactive');
              tried.delete('password');
            }
            const allowed = Array.isArray(authsLeft) ? authsLeft : item.preferredAuthentications;
            for (const method of item.preferredAuthentications) {
              if (!allowed.includes(method) || tried.has(method)) continue;
              if (method === 'publickey') { if (!privateKey) continue; tried.add('publickey'); return 'publickey'; }
              if (method === 'agent') { if (!agent) continue; tried.add('agent'); return 'agent'; }
              if (method === 'keyboard-interactive') { tried.add('keyboard-interactive'); keyboardAttempted = true; return 'keyboard-interactive'; }
              if (method === 'password') {
                if (keyboardAttempted && !partialAuthed) continue;
                if (item.authMode === '2fa' && !passwordAttempted) {
                  if (typeof secret.password === 'string' && secret.password && typeof secret.otp === 'string' && secret.otp && !used.password && !used.otp) {
                    used.password = true; used.otp = true; tried.add('password'); passwordAttempted = true;
                    return {type: 'password', username: item.username, password: `${secret.password} ${secret.otp}`};
                  }
                  if (onChallenge) {
                    tried.add('password'); passwordAttempted = true;
                    (async () => {
                      let pwd = typeof secret.password === 'string' && secret.password && !used.password ? (used.password = true, secret.password) : null;
                      if (pwd === null) {
                        const r1 = await onChallenge({kind: 'keyboard-interactive', alias: item.alias, username: item.username, hostname: item.hostname, name: '两步认证（第 1 步）', instructions: '请输入登录密码', prompts: [{prompt: 'Password: ', echo: false}]});
                        pwd = String(r1?.[0] ?? ''); used.password = true;
                      }
                      const r2 = await onChallenge({kind: 'keyboard-interactive', alias: item.alias, username: item.username, hostname: item.hostname, name: '两步认证（第 2 步）', instructions: '请输入手机动态口令', prompts: [{prompt: '2nd Password (动态口令): ', echo: false}]});
                      const otp = String(r2?.[0] ?? ''); used.otp = true;
                      cb({type: 'password', username: item.username, password: `${pwd} ${otp}`});
                    })().catch(error => {
                      interactiveError = error instanceof SshError ? error : new SshError(error?.message || '已取消 SSH 认证', error?.code || 'CANCELLED');
                      cb(false);
                    });
                    return undefined;
                  }
                }
                if (typeof secret.password === 'string' && secret.password && !used.password) {
                  used.password = true; tried.add('password'); passwordAttempted = true;
                  return {type: 'password', username: item.username, password: secret.password};
                }
              }
            }
            return false;
          };
          try { client.connect({host: item.hostname, port: item.port, username: item.username, sock,
            privateKey, passphrase: secret.passphrase, password: secret.password, agent,
            tryKeyboard: true, agentForward: false, authHandler,
            readyTimeout: onChallenge ? Math.max(item.timeout, 120000) : item.timeout,
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
export async function exec(connection, command, {timeout = 20000, maxBytes = 1024 * 1024, signal, stdin, background = false} = {}) {
  signal?.throwIfAborted();
  const deadline = new AbortController(), control = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  const timer = setTimeout(() => deadline.abort(new SshError('远端操作超时', 'REMOTE_TIMEOUT')), timeout);
  try {
    const stream = await openSession(connection.client, 'exec', [command], {signal: control, timeout, kind: background ? 'background' : 'normal'});
    return await new Promise((resolve, reject) => {
      let out = '', err = '', bytes = 0, settled = false;
      const finish = (error, result) => { if (settled) return; settled = true; control.removeEventListener('abort', abort); error ? reject(error) : resolve(result); };
      const stop = error => { stream.close(); finish(error); };
      const abort = () => stop(control.reason);
      control.addEventListener('abort', abort, {once: true});
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
      stream.end(stdin);
      if (control.aborted) abort();
    });
  } finally { clearTimeout(timer); }
}
export async function browse(connection, path = '.', {signal, timeout = 15000} = {}) {
  if (typeof path !== 'string' || !path || path.length > 4096 || /[\x00-\x1f\x7f]/.test(path)) throw new SshError('远程目录无效', 'PATH_INVALID');
  const deadline = new AbortController(), control = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  let sftp, cleanup;
  const timer = setTimeout(() => deadline.abort(new SshError('SFTP 操作超时', 'SFTP_TIMEOUT')), timeout);
  const abort = () => sftp?.destroy();
  try {
    control.throwIfAborted(); control.addEventListener('abort', abort, {once: true});
    return await Promise.race([(async () => {
      sftp = await openSession(connection.client, 'sftp', [], {signal: control, timeout}); control.throwIfAborted();
      const canonical = await call(sftp, 'realpath', path === '~' ? '.' : path.startsWith('~/') ? (await call(sftp, 'realpath', '.')) + path.slice(1) : path);
      if (!canonical.startsWith('/')) throw new SshError('首版只支持 POSIX 远端目录（Linux/macOS）', 'PLATFORM_UNSUPPORTED');
      const attrs = await call(sftp, 'stat', canonical);
      if (!attrs.isDirectory()) throw new SshError('请选择目录', 'NOT_DIRECTORY');
      const entries = await call(sftp, 'readdir', canonical);
      const directories = entries.filter(e => e.filename !== '.' && e.filename !== '..' && (e.attrs.isDirectory() || e.attrs.isSymbolicLink()))
        .map(e => ({name: e.filename, symlink: e.attrs.isSymbolicLink()})).sort((a, b) => a.name.localeCompare(b.name));
      return {path: canonical, directories: directories.slice(0, 2000), truncated: directories.length > 2000};
    })(), new Promise((_, reject) => {
      const fail = () => reject(control.reason);
      control.addEventListener('abort', fail, {once: true});
      cleanup = () => control.removeEventListener('abort', fail);
      if (control.aborted) fail();
    })]);
  } finally { clearTimeout(timer); control.removeEventListener('abort', abort); cleanup?.(); sftp?.end(); }
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

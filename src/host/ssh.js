import ssh2 from 'ssh2';
import {createHash, randomUUID} from 'node:crypto';
import {getServers} from 'node:dns';
import {readFile} from 'node:fs/promises';
import {createServer, createConnection, isIP} from 'node:net';
import {SshError, localPath} from './config.js';
import {openSession, setClientLimit} from './channels.js';
import {bootstrapShellTransport} from './shell-transport.js';
import {isOtpPrompt, isPasswordPrompt} from './auth-prompts.js';
export {openSession} from './channels.js';
export {isOtpPrompt, isPasswordPrompt} from './auth-prompts.js';

const DNS_FAILURE_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL']);

function encodeDnsTcpQuery(hostname, qtype = 1) {
  const clean = String(hostname || '').replace(/\.+$/, '');
  const labels = clean ? clean.split('.').filter(Boolean) : [];
  if (!labels.length || labels.some(label => Buffer.byteLength(label, 'utf8') > 63)) {
    throw new SshError(`无效域名：${hostname}`, 'SSH_CONNECT');
  }
  const qname = Buffer.concat([...labels.map(label => {
    const bytes = Buffer.from(label, 'utf8');
    return Buffer.concat([Buffer.from([bytes.length]), bytes]);
  }), Buffer.from([0])]);
  const id = randomUUID().replaceAll('-', '').slice(0, 4);
  const header = Buffer.from([
    parseInt(id.slice(0, 2), 16), parseInt(id.slice(2, 4), 16),
    0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
  ]);
  const question = Buffer.concat([qname, Buffer.from([0x00, qtype, 0x00, 0x01])]);
  const msg = Buffer.concat([header, question]);
  const frame = Buffer.alloc(2 + msg.length);
  frame.writeUInt16BE(msg.length, 0);
  msg.copy(frame, 2);
  return frame;
}

function skipDnsName(buf, offset) {
  let pos = offset, hops = 0;
  while (pos < buf.length && hops++ < 128) {
    const len = buf[pos];
    if (len === 0) return pos + 1;
    if ((len & 0xc0) === 0xc0) return pos + 1 < buf.length ? pos + 2 : -1;
    pos += 1 + len;
  }
  return -1;
}

function parseDnsAddresses(msg) {
  if (msg.length < 12) return [];
  if ((msg.readUInt16BE(2) & 0x000f) !== 0) return [];
  const qdcount = msg.readUInt16BE(4), ancount = msg.readUInt16BE(6);
  let pos = 12;
  for (let i = 0; i < qdcount; i++) {
    pos = skipDnsName(msg, pos);
    if (pos < 0 || pos + 4 > msg.length) return [];
    pos += 4;
  }
  const addresses = [];
  for (let i = 0; i < ancount && pos < msg.length; i++) {
    pos = skipDnsName(msg, pos);
    if (pos < 0 || pos + 10 > msg.length) break;
    const type = msg.readUInt16BE(pos), klass = msg.readUInt16BE(pos + 2), rdlength = msg.readUInt16BE(pos + 8);
    pos += 10;
    if (pos + rdlength > msg.length) break;
    if (klass === 1 && type === 1 && rdlength === 4) {
      addresses.push(`${msg[pos]}.${msg[pos + 1]}.${msg[pos + 2]}.${msg[pos + 3]}`);
    } else if (klass === 1 && type === 28 && rdlength === 16) {
      const parts = [];
      for (let k = 0; k < 16; k += 2) parts.push(msg.readUInt16BE(pos + k).toString(16));
      addresses.push(parts.join(':'));
    }
    pos += rdlength;
  }
  return addresses;
}

function querySingleTcpDns(server, port, frame, timeout, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason || new SshError('操作已取消', 'CANCELLED')); return; }
    const sock = createConnection({host: server, port});
    let settled = false, buf = Buffer.alloc(0);
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      sock.destroy();
      if (err) reject(err); else resolve(value);
    };
    const onAbort = () => finish(signal.reason || new SshError('操作已取消', 'CANCELLED'));
    const timer = setTimeout(() => finish(new Error('TCP DNS timeout')), timeout);
    sock.once('connect', () => sock.write(frame));
    sock.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length > 65535) { finish(new Error('DNS response too large')); return; }
      if (buf.length >= 2) {
        const len = buf.readUInt16BE(0);
        if (buf.length >= 2 + len) {
          const ips = parseDnsAddresses(buf.subarray(2, 2 + len));
          if (ips.length) finish(null, ips[0]);
          else finish(new Error('No address record'));
        }
      }
    });
    sock.once('error', err => finish(err));
    sock.once('close', () => { if (!settled) finish(new Error('TCP DNS closed')); });
    signal?.addEventListener('abort', onAbort, {once: true});
  });
}

export async function resolveViaTcpDns(hostname, {servers, port = 53, timeout = 4000, signal} = {}) {
  signal?.throwIfAborted();
  if (isIP(hostname)) return hostname;
  const candidates = [...new Set((servers ?? getServers()).map(s => String(s || '').split('%')[0].trim()).filter(s => isIP(s) > 0))];
  if (!candidates.length) throw new SshError(`无法解析主机名 ${hostname}`, 'SSH_CONNECT');
  for (const qtype of [1, 28]) {
    signal?.throwIfAborted();
    const frame = encodeDnsTcpQuery(hostname, qtype);
    const localAbort = new AbortController();
    const combined = signal ? AbortSignal.any([signal, localAbort.signal]) : localAbort.signal;
    try {
      const ip = await Promise.any(candidates.map(server => querySingleTcpDns(server, port, frame, timeout, combined)));
      localAbort.abort();
      if (ip) return ip;
    } catch (err) {
      localAbort.abort();
      signal?.throwIfAborted();
    }
  }
  throw new SshError(`TCP DNS 未解析出 ${hostname}`, 'SSH_CONNECT');
}

function dialTcp(host, port, timeout, signal) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const socket = createConnection({host, port});
    let settled = false, lookedUp = isIP(host) > 0;
    const lookupCap = !lookedUp ? Math.min(timeout, 3000) : timeout;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(lookupTimer);
      signal?.removeEventListener('abort', onAbort);
      if (err) { socket.destroy(); reject(err); } else resolve(value);
    };
    const onAbort = () => finish(signal.reason || new SshError('操作已取消', 'CANCELLED'));
    const timer = setTimeout(() => finish(Object.assign(new Error('connect timeout'), {code: 'ETIMEDOUT_CONNECT', lookedUp})), timeout);
    const lookupTimer = !lookedUp ? setTimeout(() => {
      if (!lookedUp) finish(Object.assign(new Error('dns lookup timeout'), {code: 'ETIMEDOUT_LOOKUP', lookedUp: false}));
    }, lookupCap) : null;
    socket.once('lookup', err => {
      clearTimeout(lookupTimer);
      if (!err) lookedUp = true;
    });
    socket.once('connect', () => finish(null, socket));
    socket.once('error', err => finish(Object.assign(err, {lookedUp})));
    signal?.addEventListener('abort', onAbort, {once: true});
  });
}

async function connectTcp(host, port, timeout, alias, signal, dnsOptions) {
  try {
    return await dialTcp(host, port, timeout, signal);
  } catch (err) {
    if (err instanceof SshError || err?.name === 'AbortError' || signal?.aborted) {
      throw err instanceof SshError ? err : new SshError('操作已取消', 'CANCELLED');
    }
    const dnsStuck = !err?.lookedUp && (DNS_FAILURE_CODES.has(err?.code) || err?.code === 'ETIMEDOUT_LOOKUP' || err?.code === 'ETIMEDOUT_CONNECT');
    if (dnsStuck && !isIP(host)) {
      let resolvedIp = '';
      try {
        resolvedIp = await resolveViaTcpDns(host, {timeout: Math.min(Math.max(timeout, 3000), 5000), signal, ...dnsOptions});
      } catch {
        signal?.throwIfAborted();
      }
      if (resolvedIp) {
        try {
          return await dialTcp(resolvedIp, port, timeout, signal);
        } catch (retryErr) {
          if (retryErr instanceof SshError || retryErr?.name === 'AbortError' || signal?.aborted) {
            throw retryErr instanceof SshError ? retryErr : new SshError('操作已取消', 'CANCELLED');
          }
          if (retryErr?.code === 'ETIMEDOUT_CONNECT') throw new SshError(`SSH ${alias}：连接超时 (${Math.round(timeout / 1000)}s)`, 'SSH_CONNECT');
          throw new SshError(`SSH ${alias}：${retryErr.message}`, 'SSH_CONNECT');
        }
      }
      throw new SshError(`SSH ${alias}：无法解析主机名 ${host}（系统 DNS 与 TCP DNS 兜底均未返回结果，请检查网络连接或 DNS）`, 'SSH_CONNECT');
    }
    if (err?.code === 'ETIMEDOUT_CONNECT') throw new SshError(`SSH ${alias}：连接超时 (${Math.round(timeout / 1000)}s)`, 'SSH_CONNECT');
    throw new SshError(`SSH ${alias}：${err.message}`, 'SSH_CONNECT');
  }
}

export const fingerprintOf = key => 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
export const endpointOf = host => `[${host.hostname}]:${host.port}`;
function authenticationError(host, kind = 'password', failed = false) {
  const label = kind === 'passphrase' ? '私钥口令' : kind === 'otp' ? '动态口令' : '登录密码';
  return new SshError(failed ? `${host.alias} 的${label}验证失败，请重新输入` : `${host.alias} 需要输入${label}`,
    failed ? 'SSH_AUTH_FAILED' : 'SSH_AUTH_REQUIRED', {alias: host.alias, username: host.username, hostname: host.hostname, kind});
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
  async connect(alias, secrets = {}, signal, {onChallenge, dnsOptions} = {}) {
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
      let previous, remoteIdent = '';
      for (const item of chain) {
        signal?.throwIfAborted();
        const sock = previous
          ? await call(previous, 'forwardOut', '127.0.0.1', 0, item.hostname, item.port)
          : await connectTcp(item.hostname, item.port, item.timeout, item.alias, signal, dnsOptions);
        if (!previous && sock) sockets.push(sock);
        const client = new ssh2.Client(); client.on('error', () => {}); clients.push(client); this.active.add(client);
        const known = await this.store.known(), endpoint = endpointOf(item), secret = secrets[item.alias] ?? {};
        let verification, interactiveError, lastCredential = 'password', submitted = false, partialRound = false;
        let probed = false, keyboardAttempted = false;
        const tried = new Set();
        const used = new Set();
        const challenge = async (kind, prompts, name = '', instructions = '') =>
          onChallenge({kind, alias: item.alias, username: item.username, hostname: item.hostname, prompts, name, instructions});
        const take = kind => {
          const value = secret[kind];
          if (!used.has(kind) && typeof value === 'string' && value) { used.add(kind); return value; }
        };
        const privateKey = item.identityFile ? await readFile(localPath(item.identityFile)) : undefined;
        let passphrase = secret.passphrase;
        if (privateKey && item.preferredAuthentications.includes('publickey')) {
          let parsed = ssh2.utils.parseKey(privateKey, passphrase);
          if (parsed instanceof Error && /passphrase|decrypt|encrypted|bad password/i.test(parsed.message)) {
            if (!onChallenge) throw authenticationError(item, 'passphrase', !!passphrase);
            [passphrase] = await challenge('passphrase', [{prompt: '私钥口令:', echo: false}], '解锁私钥');
            signal?.throwIfAborted();
            parsed = ssh2.utils.parseKey(privateKey, passphrase);
            if (parsed instanceof Error) throw authenticationError(item, 'passphrase', true);
          }
        }
        const agent = item.identityAgent === 'none' ? undefined : item.identityAgent === 'default' ? (process.env.SSH_AUTH_SOCK || (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : undefined)) : localPath(item.identityAgent);
        await new Promise((resolve, reject) => {
          let ready = false;
          const fail = error => {
            if (ready) return;
            reject(signal?.aborted ? signal.reason : verification || interactiveError || (error.level === 'client-authentication' ? authenticationError(item, lastCredential, submitted) : new SshError(`SSH ${item.alias}：${error.message}`, 'SSH_CONNECT')));
          };
          client.on('error', fail);
          client.once('close', () => { if (!ready) reject(signal?.aborted ? signal.reason : verification || interactiveError || new SshError('SSH 连接在就绪前关闭', 'SSH_CLOSED')); });
          client.once('ready', () => { ready = true; setClientLimit(client, item.maxSessions); resolve(); });
          let interactiveRounds = 0;
          client.on('keyboard-interactive', async (name, instructions, _language, prompts, finish) => {
            if (ready || closed) { finish([]); return; }
            if (++interactiveRounds > 8 || prompts.length > 8) {
              interactiveError = authenticationError(item, lastCredential, submitted); client.destroy(); return;
            }
            if (!prompts.length) { finish([]); return; }
            const answers = new Array(prompts.length), missing = [];
            for (let i = 0; i < prompts.length; i++) {
              const p = prompts[i];
              const kind = isOtpPrompt(p.prompt) ? 'otp' : isPasswordPrompt(p.prompt) ? 'password' : null;
              if (kind && !p.echo) answers[i] = take(kind);
              if (answers[i] === undefined) missing.push(i);
              if (kind) lastCredential = kind;
            }
            if (!missing.length) { submitted = true; finish(answers); return; }
            if (!onChallenge) {
              if (prompts.length === 1 && prompts[0].echo === false && isPasswordPrompt(prompts[0].prompt)) {
                interactiveError = authenticationError(item, 'password', submitted);
              } else {
                interactiveError = new SshError('服务器要求额外的交互验证，请在 DSH 界面连接。', 'SSH_INTERACTIVE_UNSUPPORTED', {alias: item.alias});
              }
              client.destroy(); return;
            }
            try {
              const supplied = await challenge('keyboard-interactive', missing.map(i => ({prompt: prompts[i].prompt, echo: !!prompts[i].echo})), name, instructions);
              if (closed || signal?.aborted) return;
              if (!Array.isArray(supplied) || supplied.length !== missing.length) throw new SshError('交互认证输入无效', 'SSH_AUTH_FAILED');
              missing.forEach((idx, k) => {
                const value = String(supplied[k] ?? '');
                answers[idx] = value;
                if (isPasswordPrompt(prompts[idx].prompt)) used.add('password');
                if (isOtpPrompt(prompts[idx].prompt)) used.add('otp');
              });
              submitted = true;
              finish(answers);
            } catch (error) {
              interactiveError = error instanceof SshError ? error : new SshError(error?.message || '已取消 SSH 认证', error?.code || 'CANCELLED');
              client.destroy();
            }
          });
          const authHandler = (authsLeft, partialSuccess, cb) => {
            if (interactiveError || closed || signal?.aborted) return false;
            if (!probed && authsLeft === null) { probed = true; return 'none'; }
            if (partialSuccess && !partialRound) {
              partialRound = true;
              tried.delete('keyboard-interactive'); tried.delete('password');
            }
            const allowed = Array.isArray(authsLeft) ? authsLeft : item.preferredAuthentications;
            for (const method of item.preferredAuthentications) {
              if (!allowed.includes(method === 'agent' ? 'publickey' : method) || tried.has(method)) continue;
              if (method === 'publickey' && !privateKey || method === 'agent' && !agent) continue;
              tried.add(method);
              if (method === 'keyboard-interactive') keyboardAttempted = true;
              if (method !== 'password') return method;
              if (keyboardAttempted && !partialRound) continue;
              lastCredential = partialRound ? 'otp' : 'password';
              const request = value => {
                submitted = true;
                return {type: 'password', username: item.username, password: value};
              };
              const value = take(lastCredential);
              if (value !== undefined) return request(value);
              if (!onChallenge || submitted && lastCredential === 'password') continue;
              const prompt = partialRound ? '2nd Password:' : 'Password:';
              challenge(lastCredential, [{prompt, echo: false}]).then(answers => {
                const [answer] = Array.isArray(answers) ? answers : [];
                if (typeof answer !== 'string' || !answer || answers.length !== 1) throw authenticationError(item, lastCredential, false);
                if (!closed && !signal?.aborted) cb(request(answer));
              }).catch(error => {
                interactiveError = error instanceof SshError ? error : new SshError('已取消 SSH 认证', 'CANCELLED');
                if (!closed) cb(false);
              });
              return undefined;
            }
            return false;
          };
          try { client.connect({host: item.hostname, port: item.port, username: item.username, sock,
            privateKey, passphrase, agent,
            debug: message => {
              const match = /^Remote ident: ['"]([^'"]+)['"]/.exec(message);
              if (match) remoteIdent = match[1];
            },
            tryKeyboard: true, agentForward: false, authHandler,
            readyTimeout: onChallenge ? Math.max(item.timeout, 120000) : item.timeout,
            keepaliveInterval: item.keepalive, keepaliveCountMax: 6,
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
              if (privateKey && /passphrase|decrypt|encrypted|bad password/i.test(error.message)) reject(authenticationError(item, 'passphrase', !!passphrase));
              else reject(error);
            }
        });
        previous = client;
        remoteIdent = client._protocol?._remoteIdentRaw?.toString() || remoteIdent;
      }
      signal?.throwIfAborted();
      const connection = {client: previous, host, remoteIdent, close: () => { signal?.removeEventListener('abort', abort); close(); }};
      const ptyFirst = /TERM-SSHD/i.test(remoteIdent);
      if (ptyFirst || host.transport === 'shell') {
        connection.useShell = true;
        connection.singleChannel = ptyFirst;
        await bootstrapShellTransport(previous, {host, secret: secrets[host.alias], onChallenge, signal, ptyFirst, onClose: connection.close});
      }
      signal?.throwIfAborted();
      signal?.removeEventListener('abort', abort);
      return connection;
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

import {randomUUID} from 'node:crypto';
import {SshError} from './config.js';
import {SshConnector, browse, exec, forward, call, nodeCommand} from './ssh.js';
import {runtimeInfo, installRuntime, launchHost, RUNTIME_VERSION} from './remote.js';

export function publicError(error) {
  return {message: error.message || 'SSH 操作失败', code: error.code || 'SSH_ERROR', ...(error.details ? {details: error.details} : {})};
}
function jsonResult(output) {
  const line = output.split(/\r?\n/).findLast(l => l.startsWith('DSH_SSH_JSON:'));
  if (!line) throw new SshError('未收到远端运行时检查结果，请检查 NodePath', 'PROBE_FAILED');
  return JSON.parse(line.slice('DSH_SSH_JSON:'.length));
}
export class RemoteManager {
  sessions = new Map(); jobs = new Map(); pending = new Map(); disposed = false;
  constructor(store) { this.store = store; this.ssh = new SshConnector(store); }
  job(action, input) {
    if (this.disposed) throw new SshError('SSH 插件已停止', 'DISPOSED');
    for (const [id, job] of this.jobs) if (job.done && job.updated < Date.now() - 10 * 60000) this.jobs.delete(id);
    if ([...this.jobs.values()].filter(j => !j.done).length >= 8 || this.jobs.size >= 100) throw new SshError('操作过多，请等待当前连接操作完成', 'BUSY');
    const id = randomUUID(), controller = new AbortController();
    const job = {id, done: false, updated: Date.now(), controller}; this.jobs.set(id, job);
    Promise.resolve().then(async () => {
      const signal = controller.signal;
      switch (action) {
        case 'check': return this.check(input.alias, input.secrets, signal);
        case 'browse': return this.browse(input.alias, input.path, input.secrets, signal);
        case 'install': return this.install(input.alias, input.secrets, signal);
        case 'open': return this.open(input.alias, input.path, input.secrets, signal);
        default: throw new SshError('未知的后台操作', 'ACTION_INVALID');
      }
    }).then(result => { job.result = result; }, error => { job.error = publicError(error); }).finally(() => { job.done = true; job.updated = Date.now(); });
    return {jobId: id};
  }
  poll(id) {
    const job = this.jobs.get(id); if (!job) throw new SshError('操作记录已过期，请重试', 'JOB_MISSING');
    return {done: job.done, result: job.result, error: job.error};
  }
  cancel(id) { const job = this.jobs.get(id); job?.controller.abort(new SshError('操作已取消', 'CANCELLED')); return {cancelled: !!job}; }
  async check(alias, secrets, signal) {
    const start = Date.now(), c = await this.ssh.connect(alias, secrets, signal);
    try {
      const directory = await browse(c, '.', {signal});
      let runtime, runtimeError;
      try { runtime = jsonResult((await exec(c, nodeCommand(c.host, runtimeInfo, [RUNTIME_VERSION]), {signal})).stdout); }
      catch (e) { runtimeError = e.message; }
      return {ssh: true, sftp: true, home: directory.path, latencyMs: Date.now() - start, runtime, runtimeError,
        ready: !!runtime?.installed && ['linux', 'darwin'].includes(runtime.platform) && Number(runtime.node.split('.')[0]) >= 22};
    } finally { c.close(); }
  }
  async browse(alias, path, secrets, signal) { const c = await this.ssh.connect(alias, secrets, signal); try { return await browse(c, path, {signal}); } finally { c.close(); } }
  async install(alias, secrets, signal) {
    const c = await this.ssh.connect(alias, secrets, signal);
    try { return jsonResult((await exec(c, nodeCommand(c.host, installRuntime, [RUNTIME_VERSION]), {timeout: 10 * 60000, maxBytes: 16384, signal})).stdout); }
    finally { c.close(); }
  }
  async open(alias, path, secrets, signal) {
    const lockKey = JSON.stringify([alias, path]);
    if (this.pending.has(lockKey)) throw new SshError('该工作区正在连接，请稍候', 'BUSY');
    this.pending.set(lockKey, true);
    let c, tunnel, channel, session;
    try {
      c = await this.ssh.connect(alias, secrets, signal);
      const directory = await browse(c, path, {signal});
      const existing = [...this.sessions.values()].find(s => s.alias === alias && s.path === directory.path && s.state === 'connected');
      if (existing) { c.close(); return this.view(existing, true); }
      if ([...this.sessions.values()].filter(s => s.state === 'connected').length >= 4) throw new SshError('最多同时打开 4 个远程工作区，请先断开一个', 'SESSION_LIMIT');
      tunnel = await forward(c);
      channel = await call(c.client, 'exec', nodeCommand(c.host, launchHost, [RUNTIME_VERSION, directory.path, alias, tunnel.port]));
      const id = randomUUID(); session = {id, alias, path: directory.path, state: 'connecting', c, tunnel, channel, url: null, startedAt: new Date().toISOString()};
      this.sessions.set(id, session);
      c.client.once('close', () => this.lost(session));
      c.client.on('error', () => this.lost(session));
      channel.once('close', () => this.lost(session));
      const remoteUrl = await new Promise((resolve, reject) => {
        let tail = ''; let settled = false;
        const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(value); };
        const abort = () => finish(signal.reason || new SshError('连接已取消', 'CANCELLED'));
        const timer = setTimeout(() => finish(new SshError('远端 DSH 启动超时，请检查安装、NodePath 与远端网络', 'START_TIMEOUT')), 90000);
        const receive = data => {
          tail = (tail + data.toString('utf8')).slice(-32768);
          const match = tail.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/[^\s\x1b]*)/);
          if (match) { const url = new URL(match[1]); if (url.searchParams.has('token')) finish(null, url); }
        };
        channel.on('data', receive); channel.stderr.on('data', receive);
        channel.once('error', error => finish(error));
        channel.once('close', () => finish(new SshError('远端 DSH 提前退出。请先检查连接并安装运行时。' + tail.replace(/([?&]token=)[^\s]+/g, '$1[REDACTED]').slice(-1500), 'HOST_EXITED')));
        signal?.addEventListener('abort', abort, {once: true}); if (signal?.aborted) abort();
      });
      signal?.throwIfAborted();
      if (session.state === 'disconnected') throw new SshError('远端 DSH 连接已关闭', 'SSH_CLOSED');
      const port = Number(remoteUrl.port);
      if (!port || port > 65535) throw new SshError('远端 Host 返回无效端口', 'PROBE_FAILED');
      tunnel.setRemote(port); remoteUrl.port = String(tunnel.port);
      session.url = remoteUrl.href; session.state = 'connected';
      await this.store.remember(alias, directory.path);
      return this.view(session, true);
    } catch (e) {
      if (session) this.lost(session); else { channel?.end(); tunnel?.close(); c?.close(); }
      throw e;
    } finally { this.pending.delete(lockKey); }
  }
  view(session, includeUrl = false) {
    return {id: session.id, alias: session.alias, path: session.path, state: session.state, startedAt: session.startedAt, ...(includeUrl && session.state === 'connected' ? {url: session.url} : {})};
  }
  list() { return [...this.sessions.values()].map(s => this.view(s)); }
  get(id) { const s = this.sessions.get(id); if (!s) throw new SshError('远程工作区连接不存在', 'SESSION_MISSING'); return this.view(s, true); }
  lost(session) {
    if (session.state === 'disconnected') return;
    session.state = 'disconnected'; session.url = null;
    // EOF tells the remote supervisor to terminate its process group first.
    session.channel.end(); session.tunnel.close();
    const timer = setTimeout(() => session.c.close(), 4000); timer.unref();
    session.channel.once('close', () => { clearTimeout(timer); session.c.close(); });
  }
  disconnect(id) { const s = this.sessions.get(id); if (s) this.lost(s); return {disconnected: !!s}; }
  dispose() { this.disposed = true; for (const j of this.jobs.values()) j.controller.abort(); for (const s of this.sessions.values()) this.lost(s); this.ssh.dispose(); }
}

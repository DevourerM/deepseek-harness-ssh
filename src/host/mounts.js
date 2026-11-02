import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile} from 'node:fs/promises';
import {join, relative, sep, posix, win32} from 'node:path';
import {SshError, atomicWrite} from './config.js';
import {SshConnector, browse, exec, quote} from './ssh.js';

export class Mounts {
  records = []; connections = new Map(); connecting = new Map(); authentication = new Map(); scope = new AsyncLocalStorage(); disposed = false;
  constructor(store, ctx = {}) { this.store = store; this.ctx = ctx; this.ssh = new SshConnector(store); }
  init() {
    return this.initRecords();
  }
  async initRecords() {
    try { this.records = JSON.parse(await readFile(join(this.store.root, 'mounts.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    for (const record of this.records) {
      await mkdir(record.localRoot, {recursive: true});
      const workspace=this.ctx.workspaceRegistry?.get(record.workspaceId);
      if(workspace?.title===record.id)await workspace.setTitle(record.title||`SSH · ${record.alias} · ${posix.basename(record.remoteRoot)||'/'}`);
    }
  }
  byPath(path) {
    if (typeof path !== 'string') return null;
    return this.records.find(record => { const rel = relative(record.localRoot, path); return !rel || rel !== '..' && !rel.startsWith('..' + sep) && !/^[A-Za-z]:/.test(rel) && !rel.startsWith(sep); }) || null;
  }
  forAgent(agent) { return agent ? this.byPath(agent.session.header.cwd) : null; }
  route(path, cwd) {
    const explicit = this.byPath(path), base = this.byPath(cwd);
    const record = explicit || base || this.scope.getStore(); if (!record) return null;
    let normalized = typeof path === 'string' ? path : '';
    if (win32.isAbsolute(normalized) && /^[a-z]:|^\\\\/i.test(normalized) && !explicit) {
      const candidate = /^[a-z]:[\\/]/i.test(normalized) ? posix.normalize(normalized.slice(2).replaceAll('\\', '/')) : '';
      if (record.remoteRoot && record.remoteRoot !== '/' && (candidate === record.remoteRoot || candidate.startsWith(record.remoteRoot + '/'))) normalized = candidate;
      else throw new SshError('SSH 工作区只接受远端 POSIX 路径，不能回退访问本机路径', 'FS_SANDBOX_DENIED');
    }
    const remoteCwd = base ? posix.resolve(base.remoteRoot, relative(base.localRoot, cwd).split(sep).join('/')) : typeof cwd === 'string' && cwd.startsWith('/') ? cwd : record.remoteRoot;
    const remotePath = explicit ? posix.resolve(explicit.remoteRoot, relative(explicit.localRoot, normalized).split(sep).join('/')) : posix.resolve(remoteCwd, normalized.replaceAll('\\', '/'));
    return {record, path: remotePath};
  }
  async connect(alias, secrets = {}, signal) {
    const previous = this.connections.get(alias); if (previous) return previous;
    const connection = await this.ssh.connect(alias, secrets, signal);
    // The lifetime of a successful workspace connection is independent of the
    // settings request that created it; callers cancel individual operations.
    connection.client.once('close', () => { if (this.connections.get(alias) === connection) this.connections.delete(alias); });
    if (this.disposed) { connection.close(); throw new SshError('SSH 工作区已停止', 'DISPOSED'); }
    this.connections.set(alias, connection);
    const pending = this.authentication.get(alias); if (pending) { clearTimeout(pending.timer); this.authentication.delete(alias); pending.resolve(connection); }
    return connection;
  }
  async ensure(alias, signal) {
    signal?.throwIfAborted(); if (this.connections.has(alias)) return this.connections.get(alias);
    let attempt = this.connecting.get(alias);
    if (!attempt) {
      attempt = this.connect(alias).catch(error => {
        if (!['SSH_AUTH_REQUIRED', 'SSH_AUTH_FAILED', 'HOST_KEY_UNKNOWN'].includes(error.code)) throw error;
        let pending = this.authentication.get(alias);
        if (!pending) {
          const deferred = Promise.withResolvers();
          pending = {id: randomUUID(), alias, error: {code: error.code, message: error.message, details: error.details}, ...deferred};
          pending.timer = setTimeout(() => { this.authentication.delete(alias); pending.reject(new SshError('SSH 认证等待超时，请重新连接', 'SSH_AUTH_TIMEOUT')); }, 120000); pending.timer.unref();
          this.authentication.set(alias, pending);
        }
        return pending.promise;
      }).finally(() => this.connecting.delete(alias));
      this.connecting.set(alias, attempt);
    }
    if (!signal) return attempt;
    return new Promise((resolve, reject) => { const abort = () => reject(signal.reason); signal.addEventListener('abort', abort, {once: true}); attempt.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort)); if (signal.aborted) abort(); });
  }
  authState() { return [...this.authentication.values()].map(({id, alias, error}) => ({id, alias, error})); }
  cancelAuth(id) { const pending = [...this.authentication.values()].find(x => x.id === id); if (pending) { clearTimeout(pending.timer); this.authentication.delete(pending.alias); pending.reject(new SshError('已取消 SSH 认证', 'CANCELLED')); } return {cancelled: !!pending}; }
  async open(alias, path, secrets, signal, title) {
    const connection = await this.connect(alias, secrets, signal), directory = await browse(connection, path, {signal});
    const customTitle = typeof title === 'string' ? title.trim().slice(0, 120) : '';
    const defaultTitle = `SSH · ${alias} · ${posix.basename(directory.path) || '/'}`;
    let record = this.records.find(r => r.alias === alias && r.remoteRoot === directory.path);
    if (!record) {
      const id = createHash('sha256').update(JSON.stringify([alias, directory.path])).digest('hex').slice(0, 24);
      const localRoot = join(this.store.root, 'workspaces', id); await mkdir(localRoot, {recursive: true});
      const resolvedTitle = customTitle || defaultTitle;
      record = {id, alias, remoteRoot: directory.path, localRoot: await (await import('node:fs/promises')).realpath(localRoot), ...(customTitle ? {title: customTitle} : {})};
      const workspace = await this.ctx.workspaceRegistry.create(record.localRoot, resolvedTitle);
      if (customTitle && workspace.title !== customTitle) await workspace.setTitle(customTitle);
      record.workspaceId = workspace.id; this.records.push(record);
      await atomicWrite(join(this.store.root, 'mounts.json'), JSON.stringify(this.records, null, 2) + '\n');
    } else {
      // The native directory picker re-adopts existing paths. Restore a useful
      // title instead of exposing the local identity directory's hash.
      let dirty = false;
      if (customTitle && record.title !== customTitle) { record.title = customTitle; dirty = true; }
      const workspace = await this.ctx.workspaceRegistry.create(record.localRoot, customTitle || record.title || defaultTitle);
      if (customTitle && workspace.title !== customTitle) await workspace.setTitle(customTitle);
      else if (workspace.title === record.id) await workspace.setTitle(record.title || defaultTitle);
      if (workspace.id !== record.workspaceId) { record.workspaceId = workspace.id; dirty = true; }
      if (dirty) await atomicWrite(join(this.store.root, 'mounts.json'), JSON.stringify(this.records, null, 2) + '\n');
    }
    await this.store.remember(alias, directory.path);
    return {...record, state: 'connected'};
  }
  list() { return this.records.map(r => ({...r, state: this.connections.has(r.alias) ? 'connected' : 'disconnected'})); }
  disconnect(alias) { this.connections.get(alias)?.close(); this.connections.delete(alias); return {disconnected: true}; }
  async check(alias, secrets, signal) {
    const started = Date.now(), c = await this.connect(alias, secrets, signal), directory = await browse(c, '.', {signal});
    const probe = await exec(c, "python3 -c 'import sys,os,fcntl; print(sys.version.split()[0])'", {signal});
    return {ssh: true, sftp: true, python: probe.stdout.trim(), ready: true, home: directory.path, latencyMs: Date.now() - started, mode: 'local-host'};
  }
  async browse(alias, path, secrets, signal) { return browse(await this.connect(alias, secrets, signal), path, {signal}); }
  async request(record, query, signal) {
    const c = await this.ensure(record.alias, signal), source = await readFile(new URL('./file-worker.py', import.meta.url), 'utf8');
    const code = `import base64;exec(base64.b64decode('${Buffer.from(source).toString('base64')}'))`;
    const result = await exec(c, `python3 -c ${quote(code)}`, {stdin: JSON.stringify(query), signal, timeout: 60000, maxBytes: 24 * 1024 * 1024, background: query.action === 'sidebar' && query.op === 'fs.watch'});
    let data; try { data = JSON.parse(result.stdout.trim()); } catch { throw new SshError('远端文件系统返回了无效数据', 'FS_IO_ERROR'); }
    if (!data.ok) { const error = new Error(data.message); error.code = data.code; throw error; } return data.value;
  }
  dispose() { this.disposed = true; for (const p of this.authentication.values()) { clearTimeout(p.timer); p.reject(new SshError('SSH 工作区已关闭', 'DISPOSED')); } this.authentication.clear(); this.ssh.dispose(); this.connections.clear(); }
}

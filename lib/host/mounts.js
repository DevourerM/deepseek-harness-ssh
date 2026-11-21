import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile} from 'node:fs/promises';
import {join, relative, sep, posix, win32} from 'node:path';
import {SshError, atomicWrite} from './config.js';
import {SshConnector, browse, exec, quote} from './ssh.js';
import {getShellTransport, isExecFallbackError} from './shell-transport.js';
import {WorkspaceConfig} from './workspace-config.js';

export class Mounts {
  records = []; connections = new Map(); connecting = new Map(); authentication = new Map(); recent = []; scope = new AsyncLocalStorage(); disposed = false; tail = Promise.resolve();
  constructor(store, ctx = {}) { this.store = store; this.ctx = ctx; this.ssh = new SshConnector(store); }
  touch(record) { if (record?.id) this.recent = [record.id, ...this.recent.filter(id => id !== record.id)]; }
  serial(fn) { const result = this.tail.then(() => { if (this.disposed) throw new SshError('SSH 工作区已停止', 'DISPOSED'); return fn(); }); this.tail = result.catch(() => {}); return result; }
  persist(records = this.records) { return atomicWrite(join(this.store.root, 'mounts.json'), JSON.stringify(records, null, 2) + '\n'); }
  async init() {
    await this.initRecords();
    this.installDirectoryReset();
  }
  installDirectoryReset() {
    const service = this.ctx.workingDirectory;
    if (this.removeDirectoryReset || !service?.get || !this.ctx.on) return;
    const descriptor = Object.getOwnPropertyDescriptor(service, 'get'), original = service.get.bind(service);
    const replacement = session => {
      const record = this.byPath(session.header.cwd);
      return record?.cwdResetSessions?.includes(session.id) ? record.localRoot : original(session);
    };
    service.get = replacement;
    const reset = async session => {
      if (!this.byPath(session.header.cwd)) return;
      // Model/tool admission runs outside the mutation queue. Wait for queued
      // edits before inspecting pending resets, then enqueue reset persistence.
      await this.tail;
      await this.resetDirectory(session);
    };
    const removers = [
      this.ctx.on('agent/pre-step', async ({agent}, next) => { await reset(agent.session); return next(); }, {prepend: true}),
      this.ctx.on('system-prompt/assemble', async (_assembly, context, next) => { if (context.agent) await reset(context.agent.session); return next(); }, {prepend: true}),
      this.ctx.on('tools/pre-execute', async (execution, next) => { await reset(execution.agent.session); return next(); }, {prepend: true})
    ];
    this.removeDirectoryReset = () => {
      for (const remove of removers) if (typeof remove === 'function') remove();
      if (Object.getOwnPropertyDescriptor(service, 'get')?.value === replacement) {
        if (descriptor) Object.defineProperty(service, 'get', descriptor); else delete service.get;
      }
      this.removeDirectoryReset = undefined;
    };
  }
  resetDirectory(session) {
    const record = this.byPath(session.header.cwd);
    if (!record?.cwdResetSessions?.includes(session.id)) return Promise.resolve();
    return this.serial(async () => {
      if (!record.cwdResetSessions?.includes(session.id)) return;
      // The durable pending set also covers histories restored after restart.
      // Append through Session's public event API before allowing model work.
      session.append('working-directory/change', {cwd: record.localRoot});
      const flushed = await this.ctx.sessions?.flush?.(session);
      if (!flushed) throw new SshError('工作区目录变更正在等待会话持久化，请恢复会话存储后重试', 'WORKSPACE_CWD_PENDING', {sessionId: session.id}, 503);
      const next = {...record, cwdResetSessions: record.cwdResetSessions.filter(id => id !== session.id)};
      await this.persist(this.records.map(value => value === record ? next : value));
      Object.assign(record, next);
    });
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
  isUnscopedRemoteCandidate(path) {
    return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !/^\/[A-Za-z]:[/\\]/.test(path);
  }
  unscopedCandidates(path) {
    const normalized = posix.normalize(path);
    const liveIds = new Set();
    for (const session of this.ctx.sessions?.list?.() || []) {
      const matched = this.byPath(session.header?.cwd);
      if (matched) liveIds.add(matched.id);
    }
    const rank = record => {
      const idx = this.recent.indexOf(record.id);
      return [liveIds.has(record.id) ? 1 : 0, idx >= 0 ? -idx : -Infinity, this.connections.has(record.alias) ? 1 : 0];
    };
    const compare = (a, b) => {
      const ra = rank(a), rb = rank(b);
      return rb[0] - ra[0] || rb[1] - ra[1] || rb[2] - ra[2];
    };
    const inside = (root, target) => {
      const rel = posix.relative(root, target);
      return !rel || rel !== '..' && !rel.startsWith('../') && !posix.isAbsolute(rel);
    };
    const matched = [], matchedSet = new Set();
    for (const record of this.records) {
      if (typeof record.remoteRoot !== 'string' || !record.remoteRoot.startsWith('/')) continue;
      const root = posix.normalize(record.remoteRoot);
      if (!inside(root, normalized)) continue;
      matched.push({record, root, specificity: root === '/' ? 0 : root.length});
      matchedSet.add(record);
    }
    matched.sort((a, b) => b.specificity - a.specificity || compare(a.record, b.record));
    const specific = matched.filter(item => item.specificity > 0).map(item => item.record);
    const rootMounts = matched.filter(item => item.specificity === 0 && (this.connections.has(item.record.alias) || liveIds.has(item.record.id))).map(item => item.record);
    const connectedFallback = this.records.filter(record => !matchedSet.has(record) && this.connections.has(record.alias)).sort(compare);
    return {path: normalized, specific, rootMounts, connectedFallback};
  }
  async connect(alias, secrets = {}, signal, options = {}) {
    const previous = this.connections.get(alias); if (previous) return previous;
    const connection = await this.ssh.connect(alias, secrets, signal, options);
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
        if (!['SSH_AUTH_REQUIRED', 'SSH_AUTH_FAILED', 'SSH_INTERACTIVE_UNSUPPORTED', 'HOST_KEY_UNKNOWN'].includes(error.code)) throw error;
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
  sessionStatus(sessionId) {
    const session = typeof sessionId === 'string' && this.ctx.sessions?.get?.(sessionId);
    const record = session && this.byPath(session.header?.cwd);
    if (!record) return {ssh: false};
    const pending = this.authentication.get(record.alias);
    const workspace = this.ctx.workspaceRegistry?.get?.(record.workspaceId);
    return {
      ssh: true,
      workspaceId: record.workspaceId,
      title: workspace?.title || record.title || '',
      alias: record.alias,
      remoteRoot: record.remoteRoot,
      state: this.connections.has(record.alias) ? 'connected' : this.connecting.has(record.alias) ? 'connecting' : 'disconnected',
      ...(pending ? {auth: {id: pending.id, alias: pending.alias, error: pending.error}} : {})
    };
  }
  cancelAuth(id) { const pending = [...this.authentication.values()].find(x => x.id === id); if (pending) { clearTimeout(pending.timer); this.authentication.delete(pending.alias); pending.reject(new SshError('已取消 SSH 认证', 'CANCELLED')); } return {cancelled: !!pending}; }
  open(alias, path, secrets, signal, title, options) { return this.serial(() => this.openSerial(alias, path, secrets, signal, title, options)); }
  async openSerial(alias, path, secrets, signal, title, options) {
    const directory = await this.browse(alias, path, secrets, signal, options);
    const customTitle = typeof title === 'string' ? title.trim().slice(0, 120) : '';
    const defaultTitle = `SSH · ${alias} · ${posix.basename(directory.path) || '/'}`;
    let record = this.records.find(r => r.alias === alias && r.remoteRoot === directory.path);
    if (!record) {
      let id = createHash('sha256').update(JSON.stringify([alias, directory.path])).digest('hex').slice(0, 24);
      // Retargeting preserves the original identity directory. Reopening that
      // original target must allocate a separate identity and conversation set.
      while (this.records.some(record => record.id === id || record.localRoot === join(this.store.root, 'workspaces', id))) id = randomUUID();
      const localRoot = join(this.store.root, 'workspaces', id); await mkdir(localRoot, {recursive: true});
      const resolvedTitle = customTitle || defaultTitle;
      record = {id, alias, remoteRoot: directory.path, localRoot: await (await import('node:fs/promises')).realpath(localRoot), ...(customTitle ? {title: customTitle} : {})};
      const workspace = await this.ctx.workspaceRegistry.create(record.localRoot, resolvedTitle), previousTitle = workspace.title;
      try {
        if (customTitle && workspace.title !== customTitle) await workspace.setTitle(customTitle);
        record.workspaceId = workspace.id;
        signal?.throwIfAborted();
        await this.persist([...this.records, record]);
        this.records.push(record);
      } catch (error) {
        if (workspace.title !== previousTitle) await workspace.setTitle(previousTitle);
        throw error;
      }
    } else {
      // Native title edits remain authoritative; only generated identity titles
      // and explicitly requested titles need repair during re-adoption.
      const workspace = this.ctx.workspaceRegistry.get?.(record.workspaceId) || await this.ctx.workspaceRegistry.create(record.localRoot, customTitle || record.title || defaultTitle);
      const title = customTitle || (workspace.title === record.id ? record.title || defaultTitle : workspace.title);
      const next = {...record, workspaceId: workspace.id, ...(customTitle ? {title: customTitle} : {})};
      const dirty = next.workspaceId !== record.workspaceId || next.title !== record.title;
      await new WorkspaceConfig(this).commit(workspace, title, dirty ? record : undefined, dirty ? next : undefined, signal);
    }
    this.touch(record);
    await this.store.remember(alias, directory.path);
    return {...record, state: 'connected'};
  }
  list() { return this.records.map(r => ({...r, state: this.connections.has(r.alias) ? 'connected' : 'disconnected'})); }
  disconnect(alias) { this.connections.get(alias)?.close(); this.connections.delete(alias); return {disconnected: true}; }
  async check(alias, secrets, signal, options) {
    const started = Date.now(), c = await this.connect(alias, secrets, signal, options);
    const directory = await this.browseConnected(c, '.', signal);
    let python = '', transport = 'exec';
    if (c.host?.transport === 'shell' || c.useShell) {
      python = (await getShellTransport(c.client).ping(signal)).python;
      c.useShell = true; transport = 'shell';
    } else {
      try {
        const probe = await exec(c, "python3 -c 'import sys,os,fcntl; print(sys.version.split()[0])'", {signal});
        python = probe.stdout.trim();
        c.execConfirmed = true;
      } catch (error) {
        if (c.host?.transport !== 'auto' || !isExecFallbackError(error)) throw error;
        python = (await getShellTransport(c.client).ping(signal)).python;
        c.useShell = true; transport = 'shell';
      }
    }
    return {ssh: true, sftp: true, python, ready: true, home: directory.path, latencyMs: Date.now() - started, mode: 'local-host', transport};
  }
  async browseConnected(c, path, signal) {
    if (c.host?.transport === 'shell' || c.useShell) return getShellTransport(c.client).browse(path, signal);
    try { return await browse(c, path, {signal}); }
    catch (error) {
      if (c.host?.transport !== 'auto' || c.execConfirmed || !isExecFallbackError(error)) throw error;
      const result = await getShellTransport(c.client).browse(path, signal);
      c.useShell = true;
      return result;
    }
  }
  async browse(alias, path, secrets, signal, options) { return this.browseConnected(await this.connect(alias, secrets, signal, options), path, signal); }
  async request(record, query, signal) {
    const c = await this.ensure(record.alias, signal);
    if (c.host?.transport === 'shell' || c.useShell) {
      return getShellTransport(c.client).fileRequest(query, signal);
    }
    const source = await readFile(new URL('./file-worker.py', import.meta.url), 'utf8');
    const code = `import base64;exec(base64.b64decode('${Buffer.from(source).toString('base64')}'))`;
    let result;
    try {
      result = await exec(c, `python3 -c ${quote(code)}`, {stdin: JSON.stringify(query), signal, timeout: 60000, maxBytes: 24 * 1024 * 1024, background: query.action === 'sidebar' && query.op === 'fs.watch'});
      c.execConfirmed = true;
    } catch (error) {
      if (c.host?.transport !== 'auto' || c.execConfirmed || !isExecFallbackError(error)) throw error;
      c.useShell = true;
      return getShellTransport(c.client).fileRequest(query, signal);
    }
    let data; try { data = JSON.parse(result.stdout.trim()); } catch { throw new SshError('远端文件系统返回了无效数据', 'FS_IO_ERROR'); }
    if (!data.ok) { const error = new Error(data.message); error.code = data.code; throw error; } return data.value;
  }
  dispose() { this.disposed = true; this.removeDirectoryReset?.(); for (const p of this.authentication.values()) { clearTimeout(p.timer); p.reject(new SshError('SSH 工作区已关闭', 'DISPOSED')); } this.authentication.clear(); this.ssh.dispose(); this.connections.clear(); }
}

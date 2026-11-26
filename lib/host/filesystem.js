import {posix} from 'node:path';

export class RemoteFileSystem {
  constructor(mounts, ErrorType = Error) { this.mounts = mounts; this.ErrorType = ErrorType; }
  error(message, code) { const error = new this.ErrorType(message, code); error.code = code; return error; }
  mapping(record) { return JSON.stringify([record.alias, record.remoteRoot]); }
  current(target) {
    if (target.ssh.mapping !== this.mapping(target.ssh.record)) throw this.error('工作区连接或目录已更新，请重新打开文件', 'FS_STALE_VERSION');
  }
  async request(target, action, extra = {}, signal) {
    this.current(target);
    try {
      const result = await this.mounts.request(target.ssh.record, {action, path: target.ssh.path, ...extra}, signal);
      this.current(target); return result;
    } catch (error) { if (error.code?.startsWith('FS_')) throw this.error(error.message, error.code); throw error; }
  }
  target(record, path) { const mapping = this.mapping(record); return {targetKey: `ssh:${record.id}:${encodeURIComponent(mapping)}:${path}`, displayPath: `ssh://${record.alias}${path}`, ssh: {record, path, mapping}}; }
  async resolve(route, signal) { const target = this.target(route.record, route.path), result = await this.request(target, 'resolve', {}, signal); return this.target(route.record, result.path); }
  processPath(target) { this.current(target); return target.ssh.path; }
  fileUrl(target) { this.current(target); return 'file://' + target.ssh.path.split('/').map(encodeURIComponent).join('/'); }
  contains(parent, child) { this.current(parent); if (!child.ssh || parent.ssh.record.id !== child.ssh.record.id) return false; this.current(child); const rel = posix.relative(parent.ssh.path, child.ssh.path); return !rel || rel !== '..' && !rel.startsWith('../') && !posix.isAbsolute(rel); }
  stat(target, signal) { return this.request(target, 'stat', {}, signal).then(result => result || undefined); }
  async lstat(route, signal) { const value = await this.request(this.target(route.record, route.path), 'lstat', {}, signal); return value || undefined; }
  async readBytes(target, signal, maxBytes = 16 * 1024 * 1024) { return Buffer.from((await this.request(target, 'read', {limit: maxBytes}, signal)).data, 'base64'); }
  async readByteRange(target, range, signal) { return Buffer.from((await this.request(target, 'read', {limit: range.length, offset: range.offset, range: true}, signal)).data, 'base64'); }
  async readText(target, signal) {
    const bytes = await this.readBytes(target, signal);
    if (bytes.includes(0)) throw this.error('文件不是 UTF-8 文本', 'FS_NOT_TEXT');
    try { return new TextDecoder('utf-8', {fatal: true}).decode(bytes); } catch { throw this.error('文件不是 UTF-8 文本', 'FS_NOT_TEXT'); }
  }
  async streamText(target, signal) { const content = await this.readText(target, signal); return (async function* () { yield content; })(); }
  async listDir(target, signal) { return (await this.request(target, 'list', {}, signal)).map(entry => ({...entry, target: this.target(target.ssh.record, posix.join(target.ssh.path, entry.name))})); }
  policy(target, supplied) {
    this.current(target);
    const policy = supplied || this.mounts.ctx.sandboxPolicy?.resolve() || {mode: 'read-only'};
    const route = this.mounts.route(policy.workspaceRoot || target.ssh.record.localRoot);
    if (policy.mode === 'read-only') throw this.error('远程工作区为只读模式', 'FS_SANDBOX_DENIED');
    if (policy.mode !== 'danger-full-access' && (!route || route.record.id !== target.ssh.record.id)) throw this.error('远程目标不属于当前可写工作区', 'FS_SANDBOX_DENIED');
    return {mode: policy.mode, root: route?.path || target.ssh.record.remoteRoot};
  }
  async writeText(target, content, expected, signal, policy) { return this.request(target, 'write', {content, expected, ...this.policy(target, policy)}, signal); }
  async editText(target, edit, expected, signal, policy) { return this.request(target, 'edit', {edit, expected, ...this.policy(target, policy)}, signal); }
  async watch(target, changed, signal) {
    signal?.throwIfAborted(); let previous = JSON.stringify(await this.stat(target, signal)), closed = false, timer;
    const poll = async () => {
      try { const next = JSON.stringify(await this.stat(target, signal)); if (!closed && next !== previous) { previous = next; changed(); } } catch (error) { if (!closed) changed(error); }
      if (!closed) { timer = setTimeout(poll, 2500); timer.unref(); }
    };
    timer = setTimeout(poll, 2500); timer.unref();
    return async () => { closed = true; clearTimeout(timer); };
  }
}

function callRemote(remote, fn) {
  try { return fn(); }
  catch (error) {
    if (error?.code?.startsWith('FS_')) throw remote.error(error.message, error.code);
    throw error;
  }
}

async function resolveUnscopedRemote(kind, path, options, signal, original, fs, mounts, remote) {
  const {path: normalized, specific, rootMounts, connectedFallback} = mounts.unscopedCandidates(path);
  const probe = async record => {
    const value = await remote[kind]({record, path: normalized}, signal);
    const ok = kind === 'lstat' ? value !== undefined : await remote.stat(value, signal) !== undefined;
    return {value, ok};
  };
  if (specific.length > 0) {
    const topLength = posix.normalize(specific[0].remoteRoot).length;
    const tied = specific.filter(record => posix.normalize(record.remoteRoot).length === topLength);
    if (tied.length === 1) return remote[kind]({record: tied[0], path: normalized}, signal);
    const first = await probe(tied[0]);
    if (first.ok) return first.value;
    for (const record of tied.slice(1)) {
      if (!mounts.connections.has(record.alias)) continue;
      try { const next = await probe(record); if (next.ok) return next.value; }
      catch (error) { if (signal?.aborted) throw error; if (!error?.code?.startsWith('FS_')) throw error; }
    }
    return first.value;
  }
  const localValue = await original(path, ...(kind === 'lstat' ? [options, signal] : [options]));
  const localExists = kind === 'lstat' ? localValue !== undefined : await fs.stat(localValue, signal).catch(() => undefined) !== undefined;
  if (localExists) return localValue;
  for (const record of [...rootMounts, ...connectedFallback]) {
    try { const next = await probe(record); if (next.ok) return next.value; }
    catch (error) { if (signal?.aborted) throw error; if (!error?.code?.startsWith('FS_')) throw error; }
  }
  return localValue;
}

export function installFileSystem(ctx, mounts, remote) {
  const fs = ctx.fs, restore = [];
  const wrap = (name, factory) => { const own = Object.getOwnPropertyDescriptor(fs, name), previous = fs[name].bind(fs); const replacement = factory(previous); fs[name] = replacement; restore.push(() => { if (Object.getOwnPropertyDescriptor(fs, name)?.value === replacement) { if (own) Object.defineProperty(fs, name, own); else delete fs[name]; } }); };
  wrap('resolve', original => (path, options) => {
    // DSH canonicalizes the bare workspace path when it creates a session.
    // Keep the identity directory in the header: the workspace registry
    // validates membership against that local directory using node:fs.
    if (typeof path === 'string' && !options && !mounts.scope.getStore() && mounts.byPath(path)?.localRoot === path) {
      return original(path, options);
    }
    const route = callRemote(remote, () => mounts.route(path, options?.cwd));
    if (route) return remote.resolve(route, options?.signal);
    if (options?.cwd === undefined && !mounts.scope.getStore() && mounts.isUnscopedRemoteCandidate(path)) {
      return resolveUnscopedRemote('resolve', path, options, options?.signal, original, fs, mounts, remote);
    }
    return original(path, options);
  });
  wrap('lstat', original => (path, options, signal) => {
    const resolvedSignal = signal || (options && typeof options === 'object' && 'aborted' in options ? options : options?.signal);
    const cwd = resolvedSignal === options ? undefined : options?.cwd;
    const route = callRemote(remote, () => mounts.route(path, cwd));
    if (route) return remote.lstat(route, resolvedSignal);
    if (cwd === undefined && !mounts.scope.getStore() && mounts.isUnscopedRemoteCandidate(path)) {
      return resolveUnscopedRemote('lstat', path, options, resolvedSignal, original, fs, mounts, remote);
    }
    return original(path, options, signal);
  });
  for (const name of ['stat', 'readText', 'streamText', 'readBytes', 'readByteRange', 'listDir', 'writeText', 'editText', 'watch', 'processPath', 'fileUrl']) wrap(name, original => (target, ...args) => target?.ssh ? remote[name](target, ...args) : original(target, ...args));
  wrap('contains', original => (parent, child) => parent?.ssh ? remote.contains(parent, child) : child?.ssh ? false : original(parent, child));
  return () => { for (const undo of restore.reverse()) undo(); };
}

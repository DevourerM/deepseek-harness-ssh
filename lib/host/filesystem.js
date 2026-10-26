import {posix} from 'node:path';

export class RemoteFileSystem {
  constructor(mounts, ErrorType = Error) { this.mounts = mounts; this.ErrorType = ErrorType; }
  error(message, code) { const error = new this.ErrorType(message, code); error.code = code; return error; }
  async request(target, action, extra = {}, signal) {
    try { return await this.mounts.request(target.ssh.record, {action, path: target.ssh.path, ...extra}, signal); }
    catch (error) { if (error.code?.startsWith('FS_')) throw this.error(error.message, error.code); throw error; }
  }
  target(record, path) { return {targetKey: `ssh:${record.id}:${path}`, displayPath: `ssh://${record.alias}${path}`, ssh: {record, path}}; }
  async resolve(route, signal) { const result = await this.mounts.request(route.record, {action: 'resolve', path: route.path}, signal); return this.target(route.record, result.path); }
  processPath(target) { return target.ssh.path; }
  fileUrl(target) { return 'file://' + target.ssh.path.split('/').map(encodeURIComponent).join('/'); }
  contains(parent, child) { if (!child.ssh || parent.ssh.record.id !== child.ssh.record.id) return false; const rel = posix.relative(parent.ssh.path, child.ssh.path); return !rel || rel !== '..' && !rel.startsWith('../') && !posix.isAbsolute(rel); }
  stat(target, signal) { return this.request(target, 'stat', {}, signal).then(result => result || undefined); }
  async lstat(route, signal) { const value = await this.mounts.request(route.record, {action: 'lstat', path: route.path}, signal); return value || undefined; }
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

export function installFileSystem(ctx, mounts, remote) {
  const fs = ctx.fs, restore = [];
  const wrap = (name, factory) => { const own = Object.getOwnPropertyDescriptor(fs, name), previous = fs[name].bind(fs); const replacement = factory(previous); fs[name] = replacement; restore.push(() => { if (Object.getOwnPropertyDescriptor(fs, name)?.value === replacement) { if (own) Object.defineProperty(fs, name, own); else delete fs[name]; } }); };
  wrap('resolve', original => (path, options) => { const route = mounts.route(path, options?.cwd); return route ? remote.resolve(route, options?.signal) : original(path, options); });
  wrap('lstat', original => (path, options, signal) => { const route = mounts.route(path, options?.cwd); return route ? remote.lstat(route, signal) : original(path, options, signal); });
  for (const name of ['stat', 'readText', 'streamText', 'readBytes', 'readByteRange', 'listDir', 'writeText', 'editText', 'watch', 'processPath', 'fileUrl']) wrap(name, original => (target, ...args) => target?.ssh ? remote[name](target, ...args) : original(target, ...args));
  wrap('contains', original => (parent, child) => parent?.ssh ? remote.contains(parent, child) : child?.ssh ? false : original(parent, child));
  return () => { for (const undo of restore.reverse()) undo(); };
}

import {SshError, revisionOf} from './config.js';

const conflict = () => new SshError('工作区配置已被其他窗口修改，请重新加载', 'WORKSPACE_CONFLICT', undefined, 409);
const validText = (value, name, max) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\x00-\x1f\x7f]/.test(value)) throw new SshError(`${name}无效`, 'REQUEST_INVALID');
  return value.trim();
};
const endpoint = (hosts, alias) => {
  const host = hosts.find(host => host.alias === alias);
  return host ? JSON.stringify([host.hostname.toLowerCase(), host.port, host.username]) : JSON.stringify([alias]);
};

// Workspace.path is the durable, public conversation identity. Only our SSH
// mapping changes; entity mutations use the public title and context APIs.
export class WorkspaceConfig {
  constructor(mounts) { this.mounts = mounts; }
  workspace(id) {
    if (typeof id !== 'string' || !id.trim()) throw new SshError('请选择工作区', 'WORKSPACE_MISSING');
    const workspace = this.mounts.ctx.workspaceRegistry.get(id);
    if (!workspace) throw new SshError('工作区不存在', 'WORKSPACE_MISSING', undefined, 404);
    return workspace;
  }
  async get(workspaceId) {
    const workspace = this.workspace(workspaceId), record = this.mounts.records.find(record => record.workspaceId === workspaceId);
    const config = await this.mounts.store.get();
    const value = {workspaceId: workspace.id, kind: record ? 'remote' : 'local', title: workspace.title, path: record ? record.remoteRoot : workspace.path, alias: record?.alias || ''};
    return {...value, revision: revisionOf(JSON.stringify([value, config.revision, record && [record.id, record.localRoot, record.title]]))};
  }
  async inactive(workspace, {allowScheduleOnly = false} = {}) {
    for (const sessionId of workspace.sessionIds) {
      const activity = await this.mounts.ctx.waterfall('workspace/session-activity', {sessionId}, () => Promise.resolve([]));
      const blocking = allowScheduleOnly ? activity.filter(item => item.kind !== 'schedule') : activity;
      const terminals = this.mounts.ctx.get?.('terminalController')?.list(sessionId) || [];
      const retained = terminals.filter(terminal => terminal.state === 'running');
      if (retained.length) blocking.push({kind: 'terminals', items: retained.map(terminal => ({id: terminal.id}))});
      if (blocking.length) throw new SshError('工作区仍有运行中的会话，请停止相关活动后修改连接或目录', 'WORKSPACE_ACTIVE', {sessionId, activity: blocking}, 409);
    }
  }
  update(input, signal, options) { return this.mounts.serial(() => this.updateSerial(input, signal, options)); }
  async updateSerial(input, signal, options) {
    signal?.throwIfAborted();
    const current = await this.get(input.workspaceId);
    if (typeof input.revision !== 'string' || input.revision !== current.revision) throw conflict();
    const title = validText(input.title, '工作区名称', 120), workspace = this.workspace(input.workspaceId);
    const record = this.mounts.records.find(record => record.workspaceId === input.workspaceId);
    if (!record) {
      if (input.path !== undefined && input.path !== workspace.path || input.alias !== undefined && input.alias !== '') throw new SshError('本地工作区路径为只读', 'PATH_READONLY');
      signal?.throwIfAborted();
      if ((await this.get(input.workspaceId)).revision !== current.revision) throw conflict();
      await this.commit(workspace, title, undefined, undefined, signal);
      return this.get(input.workspaceId);
    }
    const alias = validText(input.alias, 'SSH 主机', 80), path = validText(input.path, '远程目录', 4096);
    if (input.secrets !== undefined && (!input.secrets || typeof input.secrets !== 'object' || Array.isArray(input.secrets))) throw new SshError('凭据格式无效', 'REQUEST_INVALID');
    const requestedTargetChange = alias !== record.alias || path !== record.remoteRoot;
    const samePathSwitch = alias !== record.alias && path === record.remoteRoot;
    let directory = {path: record.remoteRoot};
    if (requestedTargetChange) {
      await this.inactive(workspace, {allowScheduleOnly: samePathSwitch});
      // Verify and canonicalize on the authenticated target before persistence.
      directory = await this.mounts.browse(alias, path, input.secrets, signal, options);
      const config = await this.mounts.store.get(), mappedEndpoint = endpoint(config.hosts, alias);
      if (this.mounts.records.some(other => other !== record && other.remoteRoot === directory.path && endpoint(config.hosts, other.alias) === mappedEndpoint)) throw new SshError('该远程目录已映射到另一个工作区', 'WORKSPACE_DUPLICATE', undefined, 409);
    }
    const targetChanged = alias !== record.alias || directory.path !== record.remoteRoot;
    if (targetChanged) await this.inactive(workspace, {allowScheduleOnly: directory.path === record.remoteRoot});
    signal?.throwIfAborted();
    if ((await this.get(input.workspaceId)).revision !== current.revision) throw conflict();
    const next = {...record, alias, remoteRoot: directory.path, title, ...(targetChanged ? {cwdResetSessions: [...workspace.sessionIds]} : {})};
    await this.commit(workspace, title, record, next, signal);
    return this.get(input.workspaceId);
  }
  async commit(workspace, title, record, next, signal) {
    const oldTitle = workspace.title;
    try {
      if (title !== oldTitle) await workspace.setTitle(title);
      signal?.throwIfAborted();
      if (record) {
        await this.mounts.persist(this.mounts.records.map(value => value === record ? next : value));
        // Existing tools and adapters retain this exact object.
        Object.assign(record, next);
      }
    } catch (error) {
      if (workspace.title !== oldTitle) {
        try { await workspace.setTitle(oldTitle); }
        catch (rollback) {
          const failure = new SshError('工作区保存失败，名称回滚失败，请重新加载并检查工作区名称', 'WORKSPACE_ROLLBACK_FAILED', {operation: error.code || 'SSH_ERROR', rollback: rollback.code || 'SSH_ERROR'}, 500);
          failure.cause = error; throw failure;
        }
      }
      throw error;
    }
  }
}

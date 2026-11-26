import {Jobs} from './jobs.js';
import {Mounts} from './mounts.js';
import {SshError} from './config.js';
import {WorkspaceConfig} from './workspace-config.js';
export class LocalManager extends Jobs {
  constructor(store, ctx) { super(); this.store = store; this.mounts = new Mounts(store, ctx); this.ssh = this.mounts.ssh; this.workspaceConfig = new WorkspaceConfig(this.mounts); }
  config(workspaceId) { return this.workspaceConfig.get(workspaceId); }
  updateWorkspace(input, signal, options) { return this.workspaceConfig.update(input, signal, options); }
  init(directoryEvent) { return this.mounts.init(directoryEvent); }
  check(...args) { return this.mounts.check(...args); }
  browse(...args) { return this.mounts.browse(...args); }
  open(...args) { return this.mounts.open(...args); }
  async connect(alias, secrets, signal, options) { await this.mounts.connect(alias, secrets, signal, options); return {connected: true, alias}; }
  async hostsStatus() {
    const config = await this.store.get();
    return {
      revision: config.revision,
      hosts: config.hosts.map(h => ({
        alias: h.alias, hostname: h.hostname, port: h.port, username: h.username,
        authMode: h.authMode, transport: h.transport, connected: this.mounts.connections.has(h.alias)
      }))
    };
  }
  list() { return this.mounts.list(); }
  get(id) { const record = this.list().find(r => r.id === id); if (!record) throw new SshError('SSH 工作区不存在', 'SESSION_MISSING'); return record; }
  disconnect(id) { const record = this.mounts.records.find(r => r.id === id); return this.mounts.disconnect(record?.alias || id); }
  rename(path, title) { return this.mounts.serial(async () => {
    if (typeof path !== 'string' || !path.trim()) throw new SshError('请选择本地文件夹路径', 'PATH_MISSING');
    const customTitle = typeof title === 'string' ? title.trim().slice(0, 120) : '';
    const workspace = await this.mounts.ctx.workspaceRegistry.create(path.trim(), customTitle || undefined);
    const record = this.mounts.records.find(record => record.workspaceId === workspace.id);
    if (customTitle) await this.workspaceConfig.commit(workspace, customTitle, record, record && {...record, title: customTitle});
    return {workspaceId: workspace.id, path: workspace.path, title: workspace.title};
  }); }
  install() { throw new SshError('本版本由本地 DSH 直接操作远程文件，不需要安装远端 DSH 或配置远端账号', 'LOCAL_HOST_MODE'); }
  dispose() { this.disposed = true; for (const job of this.jobs.values()) job.controller.abort(); this.mounts.dispose(); }
}

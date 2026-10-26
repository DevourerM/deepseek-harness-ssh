import {Jobs} from './jobs.js';
import {Mounts} from './mounts.js';
import {SshError} from './config.js';
export class LocalManager extends Jobs {
  constructor(store, ctx) { super(); this.store = store; this.mounts = new Mounts(store, ctx); this.ssh = this.mounts.ssh; }
  init() { return this.mounts.init(); }
  check(...args) { return this.mounts.check(...args); }
  browse(...args) { return this.mounts.browse(...args); }
  open(...args) { return this.mounts.open(...args); }
  async connect(alias, secrets, signal) { await this.mounts.connect(alias, secrets, signal); return {connected: true, alias}; }
  list() { return this.mounts.list(); }
  get(id) { const record = this.list().find(r => r.id === id); if (!record) throw new SshError('SSH 工作区不存在', 'SESSION_MISSING'); return record; }
  disconnect(id) { const record = this.mounts.records.find(r => r.id === id); return this.mounts.disconnect(record?.alias || id); }
  install() { throw new SshError('本版本由本地 DSH 直接操作远程文件，不需要安装远端 DSH 或配置远端账号', 'LOCAL_HOST_MODE'); }
  dispose() { this.disposed = true; for (const job of this.jobs.values()) job.controller.abort(); this.mounts.dispose(); }
}

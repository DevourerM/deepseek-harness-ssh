import {randomUUID} from 'node:crypto';
import {SshError} from './config.js';
export function publicError(error) {
  return {message: error.message || 'SSH 操作失败', code: error.code || 'SSH_ERROR', ...(error.details ? {details: error.details} : {})};
}
export class Jobs {
  jobs = new Map(); disposed = false;
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
        case 'connect': return this.connect(input.alias, input.secrets, signal);
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
}

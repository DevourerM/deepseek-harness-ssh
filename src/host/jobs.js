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
    const job = {id, done: false, updated: Date.now(), controller, challenge: null, pendingChallenge: null}; this.jobs.set(id, job);
    const onChallenge = info => {
      const signal = controller.signal;
      if (signal.aborted || job.done) return Promise.reject(signal.reason || new SshError('操作已取消', 'CANCELLED'));
      const challengeId = randomUUID(), deferred = Promise.withResolvers();
      const onAbort = () => {
        if (job.pendingChallenge?.id === challengeId) { job.challenge = null; job.pendingChallenge = null; }
        deferred.reject(signal.reason || new SshError('操作已取消', 'CANCELLED'));
      };
      signal.addEventListener('abort', onAbort, {once: true});
      job.challenge = {id: challengeId, ...info};
      job.pendingChallenge = {id: challengeId, ...deferred, cleanup: () => signal.removeEventListener('abort', onAbort)};
      return deferred.promise;
    };
    Promise.resolve().then(async () => {
      const signal = controller.signal;
      switch (action) {
        case 'check': return this.check(input.alias, input.secrets, signal, {onChallenge});
        case 'browse': return this.browse(input.alias, input.path, input.secrets, signal, {onChallenge});
        case 'install': return this.install(input.alias, input.secrets, signal);
        case 'open': return this.open(input.alias, input.path, input.secrets, signal, input.title, {onChallenge});
        case 'connect': return this.connect(input.alias, input.secrets, signal, {onChallenge});
        case 'update-workspace': return this.updateWorkspace(input, signal, {onChallenge});
        default: throw new SshError('未知的后台操作', 'ACTION_INVALID');
      }
    }).then(result => { job.result = result; }, error => { job.error = publicError(error); }).finally(() => {
      job.done = true; job.updated = Date.now();
      if (job.pendingChallenge) {
        const pending = job.pendingChallenge; job.challenge = null; job.pendingChallenge = null;
        pending.cleanup?.(); pending.reject(new SshError('操作已结束', 'CHALLENGE_EXPIRED'));
      }
    });
    return {jobId: id};
  }
  replyChallenge(jobId, challengeId, answers) {
    const job = this.jobs.get(jobId);
    if (!job || job.done) throw new SshError('认证请求已结束，请重新发起', 'CHALLENGE_EXPIRED');
    const pending = job.pendingChallenge;
    if (!pending || pending.id !== challengeId) throw new SshError('交互认证提示已过期，请按最新提示输入', 'CHALLENGE_EXPIRED');
    if (!Array.isArray(answers) || answers.length !== job.challenge.prompts.length) throw new SshError('交互认证回答数量不匹配', 'REQUEST_INVALID');
    job.challenge = null; job.pendingChallenge = null;
    pending.cleanup?.();
    pending.resolve(answers.map(value => String(value ?? '')));
    return {accepted: true};
  }
  poll(id) {
    const job = this.jobs.get(id); if (!job) throw new SshError('操作记录已过期，请重试', 'JOB_MISSING');
    return {done: job.done, result: job.result, error: job.error, ...(job.challenge ? {challenge: job.challenge} : {})};
  }
  cancel(id) { const job = this.jobs.get(id); job?.controller.abort(new SshError('操作已取消', 'CANCELLED')); return {cancelled: !!job}; }
}

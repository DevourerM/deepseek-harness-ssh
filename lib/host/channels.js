import {SshError} from './config.js';

const pools = new WeakMap();
const refused = error => /^\(SSH\) Channel open failure:/.test(error?.message || '') && [1, 2, 4].includes(error.reason);
const busy = cause => { const error = new SshError('SSH 通道暂时繁忙，请稍后再试', 'SSH_CHANNEL_BUSY', undefined, 503); if (cause) error.cause = cause; return error; };

// Track leases through CHANNEL_CLOSE, not through the exec callback or exit
// status. Servers may still count a session after its command has exited.
export class SessionChannels {
  queue = []; leases = new Set(); active = 0; opened = 0; short = 0; persistent = 0; limit = 9; shortLimit = 3; lastRefusal = 0; burst = 0; closed = false;
  constructor(client) {
    this.client = client;
    client.once('close', () => {
      this.closed = true; clearTimeout(this.wake);
      for (const item of [...this.queue, ...this.leases]) this.reject(item, new SshError('SSH 连接已关闭', 'SSH_CLOSED'));
      this.queue.length = 0;
    });
  }
  open(method, args, {signal, kind = 'normal', timeout = 20000} = {}) {
    signal?.throwIfAborted();
    if (this.closed) return Promise.reject(new SshError('SSH 连接已关闭', 'SSH_CLOSED'));
    if (this.queue.length >= 512) return Promise.reject(busy());
    const deferred = Promise.withResolvers();
    const item = {method, args, signal, kind, deferred, retries: 0, after: 0, settled: false};
    item.abort = () => { this.reject(item, signal.reason); this.pump(); };
    signal?.addEventListener('abort', item.abort, {once: true});
    item.timer = setTimeout(() => { this.reject(item, busy(item.lastError)); this.pump(); }, timeout);
    this.queue.push(item); this.pump();
    return deferred.promise;
  }
  finish(item) {
    item.settled = true; clearTimeout(item.timer); item.signal?.removeEventListener('abort', item.abort);
    const index = this.queue.indexOf(item); if (index >= 0) this.queue.splice(index, 1);
  }
  reject(item, error) { if (item.settled) return; this.finish(item); item.deferred.reject(error); }
  eligible(item) {
    if (item.after > Date.now()) return false;
    if (item.kind === 'control') return this.active < Math.min(10, this.limit + 1);
    if (this.active >= this.limit) return false;
    if (item.kind === 'persistent') return this.persistent < 8 && this.active < Math.max(1, this.limit - 1);
    return this.short < this.shortLimit;
  }
  pump() {
    if (this.closed || this.pumping) return;
    this.pumping = true;
    clearTimeout(this.wake);
    if (this.shortLimit < 3 && Date.now() - this.lastRefusal > 5000) { this.shortLimit++; this.lastRefusal = Date.now(); }
    while (true) {
      const ready = this.queue.filter(item => !item.settled && this.eligible(item));
      const item = ready.find(item => item.kind === 'control')
        || (this.burst < 5 && ready.find(item => item.kind !== 'background')) || ready[0];
      if (!item) break;
      this.burst = item.kind === 'background' ? 0 : this.burst + 1;
      this.queue.splice(this.queue.indexOf(item), 1); this.start(item);
    }
    this.pumping = false;
    const later = this.queue.filter(item => item.after > Date.now()).map(item => item.after);
    if (later.length) this.wake = setTimeout(() => this.pump(), Math.max(1, Math.min(...later) - Date.now()));
  }
  start(item) {
    this.active++; if (item.kind === 'persistent') this.persistent++; else if (item.kind !== 'control') this.short++;
    this.leases.add(item); let released = false, opened = false;
    const release = () => {
      if (released) return; released = true;
      this.active--; if (opened) this.opened--;
      if (item.kind === 'persistent') this.persistent--; else if (item.kind !== 'control') this.short--;
      this.leases.delete(item);
    };
    const callback = (error, channel) => {
      if (error) {
        release();
        // A peer's CHANNEL_OPEN_FAILURE proves the command never started.
        // Never replay an exec/subsystem failure or a lost command response.
        if (!item.settled && !this.closed && refused(error) && item.retries < 5) {
          this.shortLimit = Math.max(1, this.shortLimit - 1); this.lastRefusal = Date.now();
          item.after = Date.now() + 100 * 2 ** item.retries++ + Math.floor(Math.random() * 50);
          item.lastError = error; this.queue.push(item);
        } else this.reject(item, refused(error) ? busy(error) : error);
        this.pump(); return;
      }
      opened = true; this.opened++;
      channel.on('error', () => {});
      channel.once('close', () => { release(); this.pump(); });
      if (item.settled || this.closed || item.signal?.aborted) {
        if (!item.settled) this.reject(item, item.signal?.reason || new SshError('SSH 连接已关闭', 'SSH_CLOSED'));
        if (item.method === 'sftp') channel.destroy(); else channel.close();
        return;
      }
      this.finish(item); item.deferred.resolve(channel);
    };
    try { this.client[item.method](...item.args, callback); }
    catch (error) { callback(error); }
  }
}

export function openSession(client, method, args = [], options) {
  let pool = pools.get(client);
  if (!pool) { pool = new SessionChannels(client); pools.set(client, pool); }
  return pool.open(method, args, options);
}

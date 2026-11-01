import {PassThrough} from 'node:stream';
import {readFile} from 'node:fs/promises';
import {quote, openSession} from './ssh.js';

export class RemoteTerminal {
  output = new PassThrough(); pending = new Map(); sequence = 0; running = true; quiescent = false;
  constructor(channel, spec) {
    this.channel = channel; this.spec = spec;
    this.ready = Promise.withResolvers(); this.outcome = Promise.withResolvers(); this.done = this.outcome.promise;
    this.done.catch(() => {}); this.ready.promise.catch(() => {});
    let buffer = Buffer.alloc(0), diagnostic = '';
    this.output.on('error', () => {});
    this.output.on('drain', () => channel.resume());
    channel.on('data', data => {
      try {
        buffer = Buffer.concat([buffer, data]);
        if (buffer.length > 1024 * 1024) throw Error('SSH 终端返回的数据帧过大');
        let end;
        while ((end = buffer.indexOf(10)) >= 0) {
          const frame = JSON.parse(buffer.subarray(0, end).toString('utf8')); buffer = buffer.subarray(end + 1);
          if (frame.type === 'ready') { this.pid = frame.pid; this.ready.resolve(this); }
          else if (frame.type === 'output') { if (!this.output.write(Buffer.from(frame.data, 'base64'))) channel.pause(); }
          else if (frame.type === 'reply') {
            const item = this.pending.get(frame.id); if (!item) continue;
            this.pending.delete(frame.id); clearTimeout(item.timer);
            if (frame.error) item.reject(Error(frame.error)); else item.resolve(frame.value);
          } else if (frame.type === 'exit') this.finish(null, {exitCode: frame.exitCode, signal: frame.signal});
          else if (frame.type === 'error') throw Error(frame.message);
          else throw Error('SSH 终端协议无效');
        }
      } catch (error) { this.finish(error); channel.end(); }
    });
    channel.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk.toString('utf8')).slice(-2000); });
    channel.on('error', error => this.finish(error));
    channel.once('close', () => { if (this.running) this.finish(Error('SSH 终端连接已断开' + (diagnostic ? '：' + diagnostic : ''))); });
    this.abort = () => { this.terminate().catch(() => {}); };
    spec.signal?.addEventListener('abort', this.abort, {once: true});
    this.startTimer = setTimeout(() => { this.finish(Error('SSH 终端启动超时')); channel.end(); }, 20000); this.startTimer.unref();
    this.ready.promise.finally(() => clearTimeout(this.startTimer)).catch(() => {});
    if (spec.signal?.aborted) this.abort();
  }
  finish(error, outcome) {
    if (!this.running) return; this.running = false; clearTimeout(this.startTimer);
    this.spec.signal?.removeEventListener('abort', this.abort);
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error || Error('远程终端已退出')); }
    this.pending.clear(); this.output.end();
    if (error) { this.ready.reject(error); this.outcome.reject(error); }
    else { this.quiescent = true; this.ready.resolve(this); this.outcome.resolve(outcome); }
  }
  request(op, fields = {}) {
    if (!this.running) return Promise.reject(Error('远程终端已退出'));
    if (this.pending.size >= 128) return Promise.reject(Error('远程终端待处理请求过多'));
    const id = ++this.sequence, deferred = Promise.withResolvers();
    const timer = setTimeout(() => { this.pending.delete(id); deferred.reject(Error('远程终端请求超时')); }, 15000); timer.unref();
    this.pending.set(id, {...deferred, timer});
    this.channel.write(JSON.stringify({op, id, ...fields}) + '\n', error => { if (error) this.finish(error); });
    return deferred.promise;
  }
  write(data) {
    if (typeof data !== 'string' || Buffer.byteLength(data, 'utf8') > 65536) return Promise.reject(Error('远程终端输入过大'));
    return this.request('write', {data: Buffer.from(data, 'utf8').toString('base64')});
  }
  resize(cols, rows) { return this.request('resize', {cols, rows}); }
  inspectForeground() { return this.running ? this.request('foreground') : Promise.resolve(undefined); }
  inspectActivity() { return this.running ? this.request('activity') : Promise.resolve({state: this.quiescent ? 'idle' : 'unknown', revision: this.sequence + 1}); }
  signalForeground(signal) { return this.request('signal', {signal}); }
  terminate() {
    if (this.cleanup) return this.cleanup;
    this.cleanup = (async () => {
      // Drain queued output during shutdown so a paused SSH channel cannot
      // prevent the supervisor from acknowledging complete process cleanup.
      this.output.resume(); this.channel.resume();
      if (this.running) await this.request('terminate');
      await this.done;
      this.channel.end();
    })();
    this.cleanup.catch(() => { this.cleanup = undefined; });
    return this.cleanup;
  }
}

export class RemoteTerminals {
  handles = new Set();
  constructor(mounts) { this.mounts = mounts; }
  async shells(record, signal) { return (await this.mounts.request(record, {action: 'terminal-shells', path: record.remoteRoot}, signal)).shells; }
  async spawn(record, spec) {
    spec.signal?.throwIfAborted();
    const route = this.mounts.scope.run(record, () => this.mounts.route(spec.cwd || record.localRoot));
    if (!route || route.record.id !== record.id) throw Error('终端目录不属于当前 SSH 连接');
    if (!Array.isArray(spec.argv) || !spec.argv.length || /^[a-z]:|^\\\\/i.test(spec.argv[0])) throw Error('SSH 终端需要远端 Shell 路径');
    const env = {};
    for (const [key, value] of Object.entries(spec.env || {})) {
      if (typeof value !== 'string' || /KEY|SECRET|PASSWORD|TOKEN|^DSH_|^PATH$|^HOME$|^SHELL$/i.test(key)) continue;
      if (/^[a-z]:[\\/]|^\\\\/i.test(value)) throw Error('SSH 终端不能继承本机环境路径：' + key);
      env[key] = value;
    }
    const connection = await this.mounts.ensure(record.alias, spec.signal);
    const source = await readFile(new URL('./terminal-worker.py', import.meta.url), 'utf8');
    const code = `import base64;exec(base64.b64decode('${Buffer.from(source).toString('base64')}'))`;
    const query = {argv: spec.argv, cwd: route.path, env, terminalType: spec.terminalType, cols: spec.cols, rows: spec.rows, graceMs: spec.graceMs};
    const channel = await openSession(connection.client, 'exec', [`python3 -u -c ${quote(code)} ${quote(Buffer.from(JSON.stringify(query)).toString('base64'))}`], {kind: 'persistent', signal: spec.signal});
    const terminal = new RemoteTerminal(channel, spec); this.handles.add(terminal);
    terminal.done.finally(() => this.handles.delete(terminal)).catch(() => {});
    await terminal.ready.promise; spec.signal?.throwIfAborted();
    // Match native allocation semantics: once committed, terminals outlive the
    // create request and are owned by the controller, including across reloads.
    spec.signal?.removeEventListener('abort', terminal.abort);
    return terminal;
  }
  async dispose() { await Promise.allSettled([...this.handles].map(handle => handle.terminate())); }
}

export function installTerminalAdapter(ctx, mounts, terminals) {
  ctx.inject(['terminalController'], scope => {
    const controller = scope.terminalController, restore = [];
    const patch = (name, factory) => {
      const descriptor = Object.getOwnPropertyDescriptor(controller, name), original = controller[name].bind(controller), replacement = factory(original);
      controller[name] = replacement;
      restore.push(() => { if (Object.getOwnPropertyDescriptor(controller, name)?.value !== replacement) return; if (descriptor) Object.defineProperty(controller, name, descriptor); else delete controller[name]; });
    };
    patch('shells', original => (agent, signal) => { const record = mounts.forAgent(agent); return record ? terminals.shells(record, signal) : original(agent, signal); });
    patch('environment', original => (agent, signal) => {
      const result = original(agent, signal), record = mounts.forAgent(agent);
      return record ? {...result, cwd: mounts.scope.run(record, () => mounts.route('', ctx.workingDirectory.get(agent.session))).path} : result;
    });
    patch('create', original => async (agent, request, signal) => {
      const record = mounts.forAgent(agent); if (!record) return original(agent, request, signal);
      const shells = await terminals.shells(record, signal);
      if (!shells.length) throw Error('远端没有可用的交互 Shell');
      return mounts.scope.run(record, () => original(agent, {...request, shellPath: request.shellPath ?? shells[0].path}, signal));
    });
    scope.effect(() => () => { for (const undo of restore.reverse()) undo(); });
  });
}

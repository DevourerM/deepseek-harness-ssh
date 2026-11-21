import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PassThrough} from 'node:stream';
import {SshError} from './config.js';
import {openSession} from './channels.js';

const RPC_PREFIX = '__DSH_RPC__:';
const transports = new WeakMap();

function openShellStream(client, {pty = false, cols = 200, rows = 50, term = 'dumb', signal, timeout = 15000} = {}) {
  const arg = pty ? {term, cols, rows} : false;
  return openSession(client, 'shell', [arg], {kind: 'persistent', signal, timeout});
}

async function tryLaunchInShell(client, {pty, cols, rows, term, signal, timeout}) {
  const stream = await openShellStream(client, {pty, cols, rows, term, signal, timeout});
  const nonce = randomUUID().replaceAll('-', '');
  const marker = `__DSH_SH_${nonce}__`;
  try {
    await new Promise((resolve, reject) => {
      let buffer = '', settled = false;
      const finish = err => {
        if (settled) return; settled = true;
        clearTimeout(timer); stream.off('data', onData); stream.off('close', onClose); stream.off('error', finish);
        signal?.removeEventListener('abort', onAbort);
        err ? reject(err) : resolve();
      };
      const onAbort = () => { stream.destroy(); finish(signal.reason || new SshError('操作已取消', 'CANCELLED')); };
      const onClose = () => finish(new SshError('SSH Shell 通道已关闭', 'SSH_CLOSED'));
      const timer = setTimeout(() => { stream.destroy(); finish(new SshError('SSH Shell 启动超时', 'REMOTE_TIMEOUT')); }, timeout);
      const onData = chunk => {
        buffer = (buffer + chunk.toString('utf8')).slice(-32768);
        // Match marker on its own output line, ignoring echoed command line.
        const lines = buffer.split(/\r?\n/);
        if (lines.some(line => line.trim() === marker)) finish();
      };
      stream.on('data', onData);
      stream.once('close', onClose);
      stream.once('error', finish);
      signal?.addEventListener('abort', onAbort, {once: true});
      stream.write(`\nstty -echo 2>/dev/null; printf '\\n${marker}\\n'\n`);
    });
    return stream;
  } catch (error) {
    stream.destroy();
    throw error;
  }
}

export async function launchInShell(client, command, {pty = true, cols = 500, rows = 50, term = 'xterm-256color', signal, timeout = 20000} = {}) {
  let stream;
  try {
    stream = await tryLaunchInShell(client, {pty, cols, rows, term, signal, timeout: pty ? timeout : Math.min(timeout, 6000)});
  } catch (error) {
    if (signal?.aborted) throw error;
    stream = await tryLaunchInShell(client, {pty: !pty, cols, rows, term, signal, timeout});
  }
  stream.write(`${command}\n`);
  return stream;
}

class ShellTransport {
  pending = new Map();
  processes = new Map();
  seq = 0;
  fileLoaded = false;
  closed = false;

  constructor(client) {
    this.client = client;
    this.readyPromise = this.start();
    this.readyPromise.catch(() => {});
  }

  async start() {
    const source = await readFile(new URL('./shell-worker.py', import.meta.url), 'utf8');
    const code = `import base64;exec(base64.b64decode('${Buffer.from(source).toString('base64')}'))`;
    this.stream = await launchInShell(this.client, `python3 -u -c '${code}'; exit`, {pty: false, term: 'dumb', cols: 500, rows: 50});
    let buffer = Buffer.alloc(0);
    this.stream.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      let idx;
      while ((idx = buffer.indexOf(10)) >= 0) {
        const line = buffer.subarray(0, idx).toString('utf8').replace(/\r$/, '');
        buffer = buffer.subarray(idx + 1);
        const pos = line.indexOf(RPC_PREFIX);
        if (pos < 0) continue;
        try { this.onMessage(JSON.parse(line.slice(pos + RPC_PREFIX.length))); } catch {}
      }
    });
    const failAll = err => {
      if (this.closed) return;
      this.closed = true;
      for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(err); }
      this.pending.clear();
      for (const proc of this.processes.values()) proc.finish(null, 'SIGKILL');
      this.processes.clear();
    };
    this.stream.once('close', () => failAll(new SshError('SSH Shell 连接已关闭', 'SSH_CLOSED')));
    this.stream.once('error', err => failAll(err));
    const fileSource = await readFile(new URL('./file-worker.py', import.meta.url), 'utf8');
    await this.rpc('init_file', {source: Buffer.from(fileSource).toString('base64')}, {skipReady: true});
    this.fileLoaded = true;
  }

  onMessage(msg) {
    if (msg.event) {
      const proc = this.processes.get(msg.id);
      if (!proc) return;
      if (msg.event === 'stdout') proc.onStdout(Buffer.from(msg.data, 'base64'));
      else if (msg.event === 'stderr') proc.onStderr(Buffer.from(msg.data, 'base64'));
      else if (msg.event === 'exit') { this.processes.delete(msg.id); proc.finish(msg.exitCode, null); }
      return;
    }
    const item = this.pending.get(msg.id);
    if (!item) return;
    this.pending.delete(msg.id);
    clearTimeout(item.timer);
    if (msg.ok) item.resolve(msg.value);
    else item.reject(new SshError(msg.message || '远端操作失败', msg.code || 'SHELL_RPC_ERROR'));
  }

  async rpc(op, payload = {}, {signal, timeout = 60000, skipReady = false} = {}) {
    if (!skipReady) await this.readyPromise;
    if (this.closed) throw new SshError('SSH Shell 连接已关闭', 'SSH_CLOSED');
    signal?.throwIfAborted();
    const id = ++this.seq;
    const deferred = Promise.withResolvers();
    const onAbort = () => {
      this.pending.delete(id);
      clearTimeout(timer);
      deferred.reject(signal.reason || new SshError('操作已取消', 'CANCELLED'));
    };
    const timer = setTimeout(() => {
      this.pending.delete(id);
      signal?.removeEventListener('abort', onAbort);
      deferred.reject(new SshError('远端操作超时', 'REMOTE_TIMEOUT'));
    }, timeout);
    signal?.addEventListener('abort', onAbort, {once: true});
    this.pending.set(id, {
      resolve: v => { signal?.removeEventListener('abort', onAbort); deferred.resolve(v); },
      reject: e => { signal?.removeEventListener('abort', onAbort); deferred.reject(e); },
      timer
    });
    this.stream.write(JSON.stringify({id, op, ...payload}) + '\n');
    return deferred.promise;
  }

  ping(signal) { return this.rpc('ping', {}, {signal, timeout: 15000}); }
  browse(path, signal) { return this.rpc('browse', {path}, {signal, timeout: 15000}); }
  async fileRequest(query, signal) {
    const data = await this.rpc('file', {query}, {signal, timeout: 60000});
    if (!data.ok) { const error = new Error(data.message); error.code = data.code; throw error; }
    return data.value;
  }
  async startProcess(spec, {onStdout, onStderr, onExit, signal}) {
    await this.readyPromise;
    const targetId = ++this.seq + 1000000;
    this.processes.set(targetId, {onStdout, onStderr, finish: onExit});
    // Override id in rpc so worker registers proc under targetId.
    const id = targetId;
    const deferred = Promise.withResolvers();
    const timer = setTimeout(() => { this.pending.delete(id); this.processes.delete(targetId); deferred.reject(new SshError('远程进程启动超时', 'REMOTE_TIMEOUT')); }, 20000);
    this.pending.set(id, {resolve: deferred.resolve, reject: e => { this.processes.delete(targetId); deferred.reject(e); }, timer});
    this.stream.write(JSON.stringify({id, op: 'exec_start', spec}) + '\n');
    await deferred.promise;
    return {
      sendStdin: chunk => this.rpc('exec_stdin', {targetId, data: chunk.toString('base64')}, {signal}).catch(() => {}),
      endStdin: () => this.rpc('exec_stdin', {targetId, eof: true}, {signal}).catch(() => {}),
      kill: () => this.rpc('exec_kill', {targetId}).catch(() => {})
    };
  }
}

export function getShellTransport(client) {
  let t = transports.get(client);
  if (!t || t.closed) {
    t = new ShellTransport(client);
    transports.set(client, t);
  }
  return t;
}

export function isExecFallbackError(error) {
  if (!error) return false;
  if (['SSH_CHANNEL_BUSY', 'REMOTE_COMMAND', 'PROBE_FAILED', 'SFTP_TIMEOUT'].includes(error.code)) return true;
  return /Unable to exec|Unable to start SFTP|subsystem|Channel open failure|exec request|not supported|unsupported|open failed/i.test(error.message || '');
}

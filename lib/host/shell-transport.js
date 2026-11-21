import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Duplex, PassThrough} from 'node:stream';
import {stripVTControlCharacters} from 'node:util';
import {StringDecoder} from 'node:string_decoder';
import {deflateSync} from 'node:zlib';
import {SshError} from './config.js';
import {openSession} from './channels.js';
import {isOtpPrompt, isPasswordPrompt} from './auth-prompts.js';

const RPC_PREFIX = '__DSH_RPC__:';
const RPC_CHUNK = '__DSH_CHUNK__:';
const RPC_FINAL = '__DSH_FINAL__';
const transports = new WeakMap();
const stageLabels = {
  ping: '远端 Python 握手',
  init_file: '远端文件服务初始化',
  browse: '远程目录读取',
  file: '远程文件操作',
  exec_start: '远程进程启动',
  exec_stdin: '远程进程输入',
  exec_kill: '远程进程停止'
};

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

async function openInteractiveShell(client, {host, secret, onChallenge, signal}) {
  const timeout = host.timeout || 15000;
  const stream = await openShellStream(client, {pty: true, term: 'xterm-256color', signal, timeout});
  const marker = '__DSH_SH_' + randomUUID().replaceAll('-', '') + '__';
  const decoder = new StringDecoder('utf8');
  try {
    await new Promise((resolve, reject) => {
      let buffer = '', timer, idle, done = false, waiting = false, probing = false, credential;
      const details = kind => ({alias: host.alias, username: host.username, hostname: host.hostname, kind});
      const authError = (kind, failed) => new SshError(
        failed ? '终端认证未通过或连接已断开，请重新连接' : '请在 DSH 界面完成终端认证',
        failed ? 'SSH_AUTH_FAILED' : 'SSH_AUTH_REQUIRED', details(kind));
      const finish = error => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearTimeout(idle);
        stream.off('data', onData);
        stream.off('error', onError);
        stream.off('close', onClose);
        signal?.removeEventListener('abort', onAbort);
        if (error) reject(error); else resolve();
      };
      const onError = error => finish(credential && !probing ? authError(credential, true) : error);
      const onClose = () => onError(new SshError('SSH Shell 通道已关闭', 'SSH_CLOSED'));
      const onAbort = () => finish(signal.reason || new SshError('操作已取消', 'CANCELLED'));
      const armTimeout = (ms = timeout) => {
        clearTimeout(timer);
        timer = setTimeout(() => finish(new SshError(waiting ? '等待输入 SSH 认证超时' : '等待远端 Shell 就绪超时', waiting ? 'SSH_AUTH_TIMEOUT' : 'REMOTE_TIMEOUT')), ms);
      };
      const ask = async (kind, prompt) => {
        if (credential) { finish(authError(credential, true)); return; }
        waiting = true;
        buffer = '';
        armTimeout(120000);
        try {
          const supplied = secret?.[kind];
          if (!supplied && !onChallenge) { finish(authError(kind, false)); return; }
          const answer = supplied || (await onChallenge({
            ...details(kind), name: '', instructions: '', prompts: [{prompt, echo: false}]
          }))?.[0];
          if (done || signal?.aborted) return;
          if (typeof answer !== 'string' || !answer || /[\x00-\x1f\x7f]/.test(answer) || Buffer.byteLength(answer) > 1024) {
            finish(new SshError('终端认证输入无效', 'SSH_AUTH_FAILED', details(kind)));
            return;
          }
          waiting = false;
          credential = kind;
          buffer = '';
          armTimeout();
          stream.write(answer + '\n');
        } catch (error) {
          finish(error instanceof SshError ? error : new SshError('已取消 SSH 认证', 'CANCELLED'));
        }
      };
      const onData = chunk => {
        buffer = (buffer + decoder.write(chunk)).slice(-32768);
        const lines = stripVTControlCharacters(buffer).split(/\r?\n/);
        if (probing) {
          if (lines.some(line => line.trim() === marker)) finish();
          return;
        }
        if (waiting) return;
        clearTimeout(idle);
        const tail = lines.filter(line => line.trim()).at(-1)?.trim() || '';
        const kind = tail.length <= 120 && /[:?：]$/.test(tail) &&
          (isOtpPrompt(tail) ? 'otp' : isPasswordPrompt(tail) ? 'password' : null);
        if (kind) idle = setTimeout(() => void ask(kind, tail), 80);
        else if (/[$#%>]\s*$/.test(tail)) idle = setTimeout(() => {
          probing = true;
          stream.write("\nstty -echo 2>/dev/null; printf '\\n" + marker + "\\n'\n");
        }, 250);
      };
      stream.on('data', onData);
      stream.once('close', onClose);
      stream.once('error', onError);
      signal?.addEventListener('abort', onAbort, {once: true});
      armTimeout();
      if (signal?.aborted) onAbort();
    });
    return stream;
  } catch (error) {
    stream.destroy();
    throw error;
  }
}

class ShellTransport {
  pending = new Map();
  processes = new Map();
  seq = 0;
  fileLoaded = false;
  closed = false;
  sendQueue = Promise.resolve();

  constructor(client, options = {}) {
    this.client = client;
    this.readyPromise = this.start(options).catch(error => {
      this.closed = true;
      this.stream?.destroy();
      throw error;
    });
    this.readyPromise.catch(() => {});
  }

  async start(options) {
    const {signal, ptyFirst, onClose} = options;
    const source = await readFile(new URL('./shell-worker.py', import.meta.url), 'utf8');
    this.stream = ptyFirst
      ? await openInteractiveShell(this.client, options)
      : await tryLaunchInShell(this.client, {pty: false, term: 'dumb', cols: 500, rows: 50, signal, timeout: 4000})
        .catch(error => {
          if (signal?.aborted) throw error;
          return tryLaunchInShell(this.client, {pty: true, term: 'xterm-256color', cols: 200, rows: 50, signal, timeout: 15000});
        });
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
      onClose?.();
    };
    this.stream.once('close', () => failAll(new SshError('SSH Shell 连接已关闭', 'SSH_CLOSED')));
    this.stream.once('error', err => failAll(err));
    const loadParts = [
      'for line in sys.stdin:',
      ' line=line.strip()',
      ' if line=="__DSH_EOF__": break',
      ' parts.append(line)',
      ' print("__DSH_PART_OK__",flush=True)'
    ].join('\n');
    const loader = 'import sys,base64,zlib;print("__DSH_LOADER_READY__",flush=True);parts=[];exec(' +
      JSON.stringify(loadParts) + ');exec(zlib.decompress(base64.b64decode("".join(parts))))';
    const lines = deflateSync(source).toString('base64').match(/.{1,384}/g);
    this.waitForLine = (expected, stage, control = signal) => new Promise((resolve, reject) => {
      let pending = '';
      const finish = error => {
        clearTimeout(timer);
        this.stream.off('data', read);
        this.stream.off('close', close);
        control?.removeEventListener('abort', abort);
        if (error) reject(error); else resolve();
      };
      const read = chunk => {
        pending += chunk.toString('utf8');
        const lines = pending.split('\n');
        pending = lines.pop().slice(-4096);
        if (lines.some(line => stripVTControlCharacters(line).trim() === expected)) finish();
      };
      const close = () => finish(new SshError(stage + '时连接已关闭', 'SSH_CLOSED'));
      const abort = () => finish(control.reason);
      const timer = setTimeout(() => finish(new SshError(stage + '超时', 'REMOTE_TIMEOUT')), 15000);
      this.stream.on('data', read);
      this.stream.once('close', close);
      control?.addEventListener('abort', abort, {once: true});
      if (control?.aborted) abort();
    });
    const loaderReady = this.waitForLine('__DSH_LOADER_READY__', '启动远端 Python');
    this.stream.write("python3 -u -c '" + loader + "'; exit\n");
    await loaderReady;
    for (const [index, line] of lines.entries()) {
      const receipt = this.waitForLine('__DSH_PART_OK__', '传输远端 Python 工作进程 (' + (index + 1) + '/' + lines.length + ')');
      this.stream.write(line + '\n');
      await receipt;
    }
    const workerReady = this.waitForLine('__DSH_WORKER_READY__', '加载远端 Python 工作进程');
    this.stream.write('__DSH_EOF__\n');
    await workerReady;
    await this.rpc('ping', {}, {signal, timeout: 15000, skipReady: true});
    const fileSource = await readFile(new URL('./file-worker.py', import.meta.url), 'utf8');
    await this.rpc('init_file', {source: deflateSync(fileSource).toString('base64'), compressed: true}, {signal, timeout: 60000, skipReady: true});
    this.fileLoaded = true;
  }

  send(request, signal) {
    const result = this.sendQueue.then(async () => {
      signal?.throwIfAborted();
      if (this.closed) throw new SshError('SSH Shell 连接已关闭', 'SSH_CLOSED');
      const write = text => new Promise((resolve, reject) => this.stream.write(text + '\n', error => error ? reject(error) : resolve()));
      const json = JSON.stringify(request);
      if (Buffer.byteLength(json) <= 384) { await write(json); return; }
      const chunks = Buffer.from(json).toString('base64').match(/.{1,384}/g);
      for (const chunk of chunks) {
        const receipt = this.waitForLine('__DSH_RPC_PART_OK__', (stageLabels[request.op] || '远端操作') + '传输');
        await Promise.all([write(RPC_CHUNK + chunk), receipt]);
      }
      await write(RPC_FINAL);
    });
    this.sendQueue = result.catch(() => {});
    return result;
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
      deferred.reject(new SshError((stageLabels[op] || '远端操作') + '超时', 'REMOTE_TIMEOUT', {stage: op}));
    }, timeout);
    signal?.addEventListener('abort', onAbort, {once: true});
    this.pending.set(id, {
      resolve: v => { signal?.removeEventListener('abort', onAbort); deferred.resolve(v); },
      reject: e => { signal?.removeEventListener('abort', onAbort); deferred.reject(e); },
      timer
    });
    this.send({id, op, ...payload}, signal).catch(error => {
      const item = this.pending.get(id);
      if (!item) return;
      this.pending.delete(id);
      clearTimeout(item.timer);
      item.reject(error);
    });
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
    signal?.throwIfAborted();
    if (this.closed) throw new SshError('SSH Shell 连接已关闭', 'SSH_CLOSED');
    const targetId = ++this.seq;
    this.processes.set(targetId, {onStdout, onStderr, finish: onExit});
    // Override id in rpc so worker registers proc under targetId.
    const id = targetId;
    const deferred = Promise.withResolvers();
    const timer = setTimeout(() => { this.pending.delete(id); this.processes.delete(targetId); deferred.reject(new SshError('远程进程启动超时', 'REMOTE_TIMEOUT')); }, 20000);
    this.pending.set(id, {resolve: deferred.resolve, reject: e => { this.processes.delete(targetId); deferred.reject(e); }, timer});
    this.send({id, op: 'exec_start', spec}, signal).catch(error => {
      const item = this.pending.get(id);
      if (!item) return;
      this.pending.delete(id);
      clearTimeout(item.timer);
      item.reject(error);
    });
    await deferred.promise;
    let input = Promise.resolve();
    const send = payload => {
      const result = input.then(() => this.rpc('exec_stdin', {targetId, ...payload}));
      input = result.catch(() => {});
      return result;
    };
    return {
      sendStdin: chunk => send({data: chunk.toString('base64')}),
      endStdin: () => send({eof: true}),
      kill: () => this.rpc('exec_kill', {targetId}).catch(() => {})
    };
  }

  async openProcessChannel(spec, {signal} = {}) {
    let process;
    const channel = new Duplex({
      read() {},
      write(data, _encoding, callback) { process.sendStdin(data).then(() => callback(), callback); },
      final(callback) { process.endStdin().then(() => callback(), callback); },
      destroy(error, callback) { channel.stderr.end(); process?.kill(); callback(error); }
    });
    channel.stderr = new PassThrough();
    channel.on('error', () => {});
    channel.once('end', () => channel.destroy());
    try {
      process = await this.startProcess({...spec, hasStdin: true}, {
        signal,
        onStdout: data => channel.push(data),
        onStderr: data => channel.stderr.write(data),
        onExit: () => { channel.stderr.end(); channel.push(null); }
      });
      return channel;
    } catch (error) {
      channel.destroy();
      throw error;
    }
  }
}

export async function bootstrapShellTransport(client, options) {
  const transport = new ShellTransport(client, options);
  transports.set(client, transport);
  await transport.readyPromise;
  return transport;
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

import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Duplex, PassThrough} from 'node:stream';
import {stripVTControlCharacters} from 'node:util';
import {StringDecoder} from 'node:string_decoder';
import {SshError} from './config.js';
import {openSession} from './channels.js';
import {isOtpPrompt, isPasswordPrompt} from './auth-prompts.js';

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
    const loader = 'import sys,base64,itertools;exec(base64.b64decode("".join(line.strip() for line in itertools.takewhile(lambda line:line.strip()!="__DSH_EOF__",sys.stdin))))';
    const lines = Buffer.from(source).toString('base64').match(/.{1,512}/g);
    this.stream.write("python3 -u -c '" + loader + "'; exit\n" + lines.join('\n') + '\n__DSH_EOF__\n');
    await this.rpc('ping', {}, {signal, timeout: 15000, skipReady: true});
    const fileSource = await readFile(new URL('./file-worker.py', import.meta.url), 'utf8');
    await this.rpc('init_file', {source: Buffer.from(fileSource).toString('base64')}, {signal, timeout: 15000, skipReady: true});
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
    signal?.throwIfAborted();
    if (this.closed) throw new SshError('SSH Shell 连接已关闭', 'SSH_CLOSED');
    const targetId = ++this.seq;
    this.processes.set(targetId, {onStdout, onStderr, finish: onExit});
    // Override id in rpc so worker registers proc under targetId.
    const id = targetId;
    const deferred = Promise.withResolvers();
    const timer = setTimeout(() => { this.pending.delete(id); this.processes.delete(targetId); deferred.reject(new SshError('远程进程启动超时', 'REMOTE_TIMEOUT')); }, 20000);
    this.pending.set(id, {resolve: deferred.resolve, reject: e => { this.processes.delete(targetId); deferred.reject(e); }, timer});
    this.stream.write(JSON.stringify({id, op: 'exec_start', spec}) + '\n');
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

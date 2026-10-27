import {PassThrough} from 'node:stream';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {win32} from 'node:path';
import {quote, call} from './ssh.js';
import {installSubagentAdapter} from './subagents.js';
import {RemoteTerminals, installTerminalAdapter} from './terminals.js';

class Capture {
  bytes = Buffer.alloc(0); total = 0;
  constructor(maxBytes) { this.maxBytes = maxBytes || 1024 * 1024; }
  add(chunk) { this.total += chunk.length; this.bytes = Buffer.concat([this.bytes, chunk]); if (this.bytes.length > this.maxBytes) this.bytes = this.bytes.subarray(this.bytes.length - this.maxBytes); }
  readFrom(offset) { const start = this.total - this.bytes.length; return {text: this.bytes.subarray(Math.max(0, offset - start)).toString('utf8'), nextOffset: this.total, lossy: offset < start}; }
}
export class RemoteProcesses {
  handles = new Set();
  constructor(mounts) { this.mounts = mounts; }
  spawn(record, spec) {
    const out = new PassThrough(), err = new PassThrough(), input = new PassThrough();
    const control = randomUUID(); let stream, connection, pid, killing = false, finished = false, terminated = false;
    const stop = () => {
      terminated = true;
      if (!connection || !pid || killing || finished) return;
      killing = true;
      // OpenSSH servers may ignore SSH channel signal requests. A separate
      // authenticated channel signals the remote supervisor, which owns the group.
      call(connection.client, 'exec', 'kill -TERM ' + pid).then(channel => {channel.on('error',()=>{});channel.resume();channel.stderr.resume();channel.end();}).catch(()=>{});
    };
    const stdout = new Capture(spec.stdio?.stdout?.maxBytes), stderr = new Capture(spec.stdio?.stderr?.maxBytes);
    out.on('data', data => stdout.add(data)); err.on('data', data => stderr.add(data)); out.on('error', () => {}); err.on('error', () => {}); input.on('error', () => {});
    const handle = {stdin: spec.stdio?.stdin === 'pipe' ? input : null, stdout: spec.stdio?.stdout === 'pipe' ? out : null, stderr: spec.stdio?.stderr === 'pipe' ? err : null,
      collected: {stdout, stderr}, terminate: stop,
      waitForExit: () => handle.done.then(() => true)};
    this.handles.add(handle);
    const abort = () => handle.terminate(); spec.signal?.addEventListener('abort', abort, {once: true});
    handle.done = (async () => {
      spec.signal?.throwIfAborted(); const c = await this.mounts.ensure(record.alias, spec.signal); connection = c;
      const route = this.mounts.route(spec.cwd || record.localRoot), cwd = route?.record.id === record.id ? route.path : record.remoteRoot;
      const mapArg = value => { const record = this.mounts.byPath(value); const route = record ? this.mounts.route(value) : null; return route ? route.path : value; };
      const argv = spec.argv.map(mapArg), executable = win32.basename(argv[0]).replace(/\.exe$/i, '');
      if (/^[a-z]:/i.test(argv[0])) argv[0] = executable;
      const env = {};
      for (const [key, value] of Object.entries(spec.env || {})) if (typeof value === 'string' && !/KEY|SECRET|PASSWORD|TOKEN|^DSH_|^PATH$|^HOME$/i.test(key)) {
        if (/^[a-z]:[\\/]/i.test(value) && !this.mounts.byPath(value)) throw Error('此远程进程不能访问本机暂存路径：' + key);
        env[key] = mapArg(value);
      }
      const source = await readFile(new URL('./process-worker.py', import.meta.url), 'utf8');
      const code = `import base64;exec(base64.b64decode('${Buffer.from(source).toString('base64')}'))`;
      const command = `python3 -c ${quote(code)} ${quote(Buffer.from(JSON.stringify({argv, cwd, env, control})).toString('base64'))}`;
      stream = await call(c.client, 'exec', command);
      if (terminated || spec.signal?.aborted) handle.terminate();
      let pending = Buffer.alloc(0), controlSeen = false;
      stream.on('data', data => out.write(data));
      stream.stderr.on('data', data => {
        if (controlSeen) {err.write(data); return;}
        pending = Buffer.concat([pending, data]);
        let end;
        while ((end = pending.indexOf(10)) >= 0) {
          const line = pending.subarray(0, end + 1); pending = pending.subarray(end + 1);
          const match = line.toString('utf8').match(new RegExp('^DSH_SSH_CONTROL:' + control + ':(\\d+)\\r?\\n$'));
          if (match) {pid = Number(match[1]); controlSeen = true; if (terminated) stop(); if(pending.length)err.write(pending); pending=Buffer.alloc(0); break;}
          err.write(line);
        }
        if (pending.length > 16384) {err.write(pending); pending = Buffer.alloc(0);}
      });
      if (spec.stdio?.stdin === 'pipe') input.pipe(stream);
      else if (typeof spec.stdio?.stdin === 'object') stream.end(spec.stdio.stdin.data);
      else stream.end();
      return await new Promise((resolve, reject) => { stream.once('error', reject); stream.once('close', (code, signal) => resolve({exitCode: typeof code === 'number' ? code : null, signal: signal || (terminated ? 'SIGTERM' : null)})); });
    })().finally(() => { finished = true; out.end(); err.end(); input.destroy(); this.handles.delete(handle); spec.signal?.removeEventListener('abort', abort); });
    handle.done.catch(() => {}); return handle;
  }
  async execute(record, command, cwd, signal, timeout = 60000) {
    const control = new AbortController(), combined = signal ? AbortSignal.any([signal, control.signal]) : control.signal;
    const timer = setTimeout(() => control.abort(Error('远程命令超时')), Math.min(Math.max(timeout, 1000), 300000));
    const handle = this.spawn(record, {argv: ['bash', '-lc', command], cwd, signal: combined, stdio: {stdin: 'ignore', stdout: {maxBytes: 2 * 1024 * 1024}, stderr: {maxBytes: 512 * 1024}}});
    try { const result = await handle.done; return {...result, stdout: handle.collected.stdout.readFrom(0).text, stderr: handle.collected.stderr.readFrom(0).text}; }
    finally { clearTimeout(timer); }
  }
  dispose() { for (const handle of this.handles) handle.terminate(); }
}

export async function installLocalAdapter(ctx, mounts) {
  const {FsError} = await import('@deepseek-ai/dsh-fs'), {defineTool} = await import('@deepseek-ai/dsh-tools');
  const {RemoteFileSystem, installFileSystem} = await import('./filesystem.js');
  const remote = new RemoteFileSystem(mounts, FsError), processes = new RemoteProcesses(mounts);
  const terminals = new RemoteTerminals(mounts); installTerminalAdapter(ctx, mounts, terminals);
  const restore = [installFileSystem(ctx, mounts, remote), installSubagentAdapter(ctx, mounts)];
  const patch = (owner, name, factory) => { const descriptor = Object.getOwnPropertyDescriptor(owner, name), old = owner[name].bind(owner); const replacement = factory(old); owner[name] = replacement; restore.push(() => { if (Object.getOwnPropertyDescriptor(owner, name)?.value === replacement) { if (descriptor) Object.defineProperty(owner, name, descriptor); else delete owner[name]; } }); };
  patch(ctx.workspaceRegistry, 'create', old => (path, title, ...args) => {
    const record = mounts.byPath(path);
    return old(path, title || (record ? `SSH · ${record.alias} · ${record.remoteRoot.split('/').at(-1) || '/'}` : title), ...args);
  });
  patch(ctx.subprocess, 'spawn', old => spec => { const route = mounts.route(spec.cwd || ''); return route ? processes.spawn(route.record, spec) : old(spec); });
  patch(ctx.subprocess, 'spawnTerminal', old => spec => {
    const route = mounts.route(spec.cwd || '');
    return route ? terminals.spawn(route.record, spec) : old(spec);
  });
  patch(ctx.tools, 'view', old => scope => {
    const result = old(scope); if (!mounts.forAgent(scope)) return result;
    const visible = new Map(result.visible); visible.delete('pwsh'); visible.delete('bash');
    return {...result, visible};
  });
  patch(ctx.workingDirectory, 'ensure', old => (agent, signal) => { const record = mounts.forAgent(agent); return record ? mounts.scope.run(record, async () => { const current = await old(agent, signal); return mounts.route(current)?.path || current; }) : old(agent, signal); });
  patch(ctx.workingDirectory, 'contextText', old => session => { const record = mounts.byPath(session.header.cwd); const route = record && mounts.route('', ctx.workingDirectory.get(session)); return record ? `Current working directory: ${JSON.stringify(route?.path || record.remoteRoot)} on SSH host ${record.alias}. Files and commands execute remotely. The model, account and conversation are local.` : old(session); });
  ctx.on('tools/execute', (execution, next) => { const record = mounts.forAgent(execution.agent); return record ? mounts.scope.run(record, next) : next(); }, {prepend: true});
  ctx.on('system-prompt/assemble', (assembly, context, next) => { const record = mounts.forAgent(context.agent); return record ? mounts.scope.run(record, next) : next(); }, {prepend: true});
  const installed = new WeakSet();
  const attach = agent => {
    const record = mounts.forAgent(agent); if (!record || installed.has(agent)) return; installed.add(agent);
    ctx.effect(() => agent.ctx.tools.register(defineTool({name: 'ssh_exec', description: `Run a Bash command on SSH host ${record.alias}. Uses the remote workspace, never local PowerShell.`,
      parameters: {command: {type: 'string', required: true}, timeout_ms: {type: 'integer'}},
      output: {schema: {type: 'object', additionalProperties: false, properties: {stdout: {type: 'string', required: true}, stderr: {type: 'string', required: true}, exitCode: {oneOf: [{type: 'integer'}, {type: 'null'}], required: true}, signal: {oneOf: [{type: 'string'}, {type: 'null'}], required: true}}}, render: (_args, value) => [{type: 'text', text: value.stdout + (value.stderr ? '\n[stderr]\n' + value.stderr : '') + `\n[exit code: ${value.exitCode}]`}]},
      async execute(args, execution) { return processes.execute(record, args.command, ctx.workingDirectory.get(agent.session), execution.signal, args.timeout_ms); }
    })));
    for (const name of ['glob', 'grep']) ctx.effect(() => agent.ctx.tools.register(defineTool({name,
      description: name === 'glob' ? 'Find files in the remote SSH workspace by glob pattern. Skips hidden directories and node_modules. Maximum 1000 results, scans at most 10000 files.' : 'Search remote UTF-8 files using Python regular expressions. Optional include glob. Skips hidden directories, node_modules, and files over 2 MiB. Maximum 1000 matches, scans at most 10000 files.',
      parameters: {pattern: {type: 'string', required: true}, path: {type: 'string'}, ...(name === 'grep' ? {include: {type: 'string'}} : {})},
      output: {schema: {type: 'object', additionalProperties: true}, render: (_args, value) => [{type: 'text', text: JSON.stringify(value)}]},
      async execute(args, execution) {
        const cwd = ctx.workingDirectory.get(agent.session), route = mounts.route(args.path || '', cwd);
        if (!route || route.record.id !== record.id) throw Error('搜索路径不属于此 SSH 工作区');
        return mounts.request(record, {action: name, path: route.path, pattern: args.pattern, include: args.include}, execution.signal);
      }
    })));
  };
  ctx.on('agent/created', ({agent}) => attach(agent));
  for (const session of ctx.sessions?.list() || []) { const agent = ctx.agents?.get(session.id); if (agent) attach(agent); }
  ctx.on('tools/pre-execute', async (execution, next) => {
    const record = mounts.forAgent(execution.agent), decision = await next();
    if (!record || decision.kind !== 'allow' || execution.name !== 'ssh_exec') return decision;
    const mode = ctx.sandboxPolicy.resolve({session: execution.agent.session}).mode;
    if (mode === 'danger-full-access') return decision;
    return {kind: 'ask', reason: `在 SSH 主机 ${record.alias} 的 ${record.remoteRoot} 执行命令。远程 Shell 不使用本机沙箱，本次需要确认。`};
  }, {prepend: true});
  ctx.systemPrompt.context({name: 'ssh-workspace', order: -90, required: true, text: ({agent}) => { const record = mounts.forAgent(agent); return record ? `This is an SSH workspace on ${record.alias}, remote root ${record.remoteRoot}. Use POSIX file paths and ssh_exec for Bash commands. Native read/write/edit tools access the remote files directly. Never run local PowerShell. No remote DSH or model account is involved.` : ''; }});
  return async () => { processes.dispose(); await terminals.dispose(); for (const undo of restore.reverse()) undo(); };
}

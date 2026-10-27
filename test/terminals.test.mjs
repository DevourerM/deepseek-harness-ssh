import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {RemoteTerminal, installTerminalAdapter} from '../src/host/terminals.js';
import {Mounts} from '../src/host/mounts.js';

class Channel extends EventEmitter {
  stderr = new PassThrough(); requests = []; paused = false;
  frame(value) { this.emit('data', Buffer.from(JSON.stringify(value) + '\n')); }
  write(data, callback) { this.requests.push(JSON.parse(data)); callback?.(); return true; }
  pause() { this.paused = true; }
  resume() { this.paused = false; }
  end() { this.ended = true; }
  reply(value = null) { this.frame({type: 'reply', id: this.requests.at(-1).id, value}); }
}

test('remote terminal decodes split UTF-8 frames and carries input, resize and foreground control', async () => {
  const channel = new Channel(), terminal = new RemoteTerminal(channel, {}), chunks = [];
  terminal.output.on('data', chunk => chunks.push(chunk));
  channel.frame({type: 'ready', pid: 123}); assert.equal(await terminal.ready.promise, terminal);
  const frame = Buffer.from(JSON.stringify({type: 'output', data: Buffer.from('中文\r\n').toString('base64')}) + '\n');
  channel.emit('data', frame.subarray(0, 7)); channel.emit('data', frame.subarray(7));
  assert.equal(Buffer.concat(chunks).toString(), '中文\r\n');
  const input = terminal.write('echo 中文\r'); assert.equal(Buffer.from(channel.requests.at(-1).data, 'base64').toString(), 'echo 中文\r'); channel.reply(); await input;
  const resize = terminal.resize(132, 42); assert.deepEqual({...channel.requests.at(-1), id: 0}, {op: 'resize', id: 0, cols: 132, rows: 42}); channel.reply(); await resize;
  const foreground = terminal.inspectForeground(); channel.reply({processGroupId: 124, inputWaiting: 'unknown'}); assert.equal((await foreground).processGroupId, 124);
  const interrupt = terminal.signalForeground('SIGINT'); assert.equal(channel.requests.at(-1).signal, 'SIGINT'); channel.reply(124); assert.equal(await interrupt, 124);
  channel.frame({type: 'exit', exitCode: 7, signal: null}); assert.deepEqual(await terminal.done, {exitCode: 7, signal: null});
});

test('terminal close waits for remote cleanup and transport failure rejects outstanding operations', async () => {
  const channel = new Channel(), terminal = new RemoteTerminal(channel, {}); channel.frame({type: 'ready', pid: 1});
  let closed = false; const closing = terminal.terminate().then(() => { closed = true; });
  channel.reply(); await Promise.resolve(); assert.equal(closed, false);
  channel.frame({type: 'exit', exitCode: null, signal: 'SIGHUP'}); await closing; assert.equal(channel.ended, true);
  const brokenChannel = new Channel(), broken = new RemoteTerminal(brokenChannel, {}); brokenChannel.frame({type: 'ready', pid: 2});
  const pending = broken.write('x'); const rejected = assert.rejects(pending, /连接已断开/); const done = assert.rejects(broken.done, /连接已断开/);
  brokenChannel.emit('close'); await rejected; await done;
  assert.equal((await broken.inspectActivity()).state, 'unknown', 'lost transport cannot prove remote quiescence');
  await assert.rejects(() => broken.write('x'), /已退出/);
  const invalid = new RemoteTerminal(new Channel(), {}); await assert.rejects(() => invalid.write('x'.repeat(65537)), /过大/); invalid.finish(Error('test cleanup'));
});

test('native terminal adapter selects remote shells and scopes POSIX startup while preserving local calls and unload', async () => {
  const mounts = new Mounts({}), record = {id: 'one', localRoot: join(tmpdir(), 'ssh-term'), remoteRoot: '/srv/remote'}; mounts.records = [record];
  const remoteAgent = {session: {header: {cwd: record.localRoot}}}, localAgent = {session: {header: {cwd: tmpdir()}}};
  const cleanup = [], requests = [], shells = [{path: '/bin/bash', name: 'bash', args: ['-i']}];
  const controller = {
    environment: () => ({cwd: record.localRoot, maxInputBytes: 65536}),
    shells: () => 'local-shells',
    create: async (agent, request) => { await Promise.resolve(); requests.push(request); return mounts.forAgent(agent) ? mounts.route('/srv/remote/sub') : 'local'; },
  };
  const original = {...controller};
  const ctx = {workingDirectory: {get: () => '/srv/remote/sub'}, terminalController: controller, inject: (_names, fn) => fn({...ctx, effect: effect => cleanup.push(effect())})};
  installTerminalAdapter(ctx, mounts, {shells: async () => shells});
  assert.equal((await controller.shells(remoteAgent))[0].path, '/bin/bash'); assert.equal(controller.shells(localAgent), 'local-shells');
  assert.equal(controller.environment(remoteAgent).cwd, '/srv/remote/sub'); assert.equal(controller.environment(remoteAgent).maxInputBytes, 65536);
  assert.equal((await controller.create(remoteAgent, {id: 'term'})).record, record); assert.equal(requests[0].shellPath, '/bin/bash');
  assert.equal(await controller.create(localAgent, {id: 'local'}), 'local'); assert.equal(requests[1].shellPath, undefined);
  assert.equal(mounts.scope.getStore(), undefined);
  for (const close of cleanup) close(); for (const name of Object.keys(original)) assert.equal(controller[name], original[name]);
});

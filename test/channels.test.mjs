import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import ssh2 from 'ssh2';
import {SessionChannels} from '../src/host/channels.js';
import {ConfigStore} from '../src/host/config.js';
import {Mounts} from '../src/host/mounts.js';
import {SidebarAdapter} from '../src/host/sidebar.js';
import {exec, browse, fingerprintOf} from '../src/host/ssh.js';
import {sshFixture} from './ssh-fixture.mjs';

class Channel extends EventEmitter {
  close() { this.closed = true; this.emit('close'); }
  destroy() { this.close(); }
}
class Client extends EventEmitter {
  calls = [];
  exec(command, callback) { const channel = new Channel(); this.calls.push({command, channel}); callback(null, channel); }
}

test('short SSH sessions queue through actual close, not command exit', async () => {
  const client = new Client(), pool = new SessionChannels(client);
  const running = await Promise.all([1, 2, 3].map(n => pool.open('exec', [String(n)])));
  const queued = pool.open('exec', ['4']); assert.equal(client.calls.length, 3);
  running[0].emit('exit', 0); running[0].emit('end'); assert.equal(client.calls.length, 3);
  running[0].close(); const next = await queued; assert.equal(client.calls.length, 4);
  for (const channel of [...running.slice(1), next]) channel.close(); assert.equal(pool.active, 0);
});

test('eight persistent terminals leave room for directory traffic and a termination control channel', async () => {
  const client = new Client(), pool = new SessionChannels(client);
  const terminals = await Promise.all(Array.from({length: 8}, (_, n) => pool.open('exec', ['term' + n], {kind: 'persistent'})));
  const read = await pool.open('exec', ['read']);
  const waiting = pool.open('exec', ['next-read']); assert.equal(client.calls.length, 9);
  const stop = await pool.open('exec', ['kill'], {kind: 'control'}); assert.equal(client.calls.length, 10);
  read.close(); assert.equal(client.calls.length, 10, 'control lease still counts against the data budget');
  stop.close(); const next = await waiting; assert.equal(client.calls.at(-1).command, 'next-read');
  for (const channel of [...terminals, next]) channel.close(); assert.equal(pool.active, 0);
});

test('foreground directory requests precede watch polling without starving background work', async () => {
  const client = new Client(), pool = new SessionChannels(client);
  const running = await Promise.all([1, 2, 3].map(n => pool.open('exec', ['busy' + n])));
  const watch = pool.open('exec', ['watch'], {kind: 'background'}), tree = pool.open('exec', ['tree']);
  running[0].close(); const treeChannel = await tree; assert.equal(client.calls.at(-1).command, 'tree');
  treeChannel.close(); const watchChannel = await watch; assert.equal(client.calls.at(-1).command, 'watch');
  for (const channel of [...running.slice(1), watchChannel]) channel.close();
});

test('cancelled queued requests never open and late channels are closed without releasing slots early', async () => {
  const client = new Client(), pool = new SessionChannels(client);
  const running = await Promise.all([1, 2, 3].map(n => pool.open('exec', [String(n)])));
  const control = new AbortController(), queued = pool.open('exec', ['cancelled'], {signal: control.signal});
  const cancelled = assert.rejects(queued, /cancelled/); control.abort(Error('cancelled')); await cancelled;
  for (const channel of running) channel.close(); assert.equal(client.calls.length, 3);
  let callback; client.exec = (_command, next) => { callback = next; };
  const opening = new AbortController(), late = pool.open('exec', ['opening'], {signal: opening.signal});
  const rejected = assert.rejects(late, /cancel startup/); opening.abort(Error('cancel startup')); await rejected;
  assert.equal(pool.active, 1);
  const channel = new Channel(); callback(null, channel); assert.equal(channel.closed, true); assert.equal(pool.active, 0);
});

test('only peer channel-open refusals retry; exec failures and uncertain responses never replay', async () => {
  const client = new Client(), pool = new SessionChannels(client); let attempts = 0;
  client.exec = (_command, callback) => {
    if (++attempts < 3) callback(Object.assign(Error('(SSH) Channel open failure: open failed'), {reason: 2}));
    else callback(null, new Channel());
  };
  const channel = await pool.open('exec', ['mutation']); assert.equal(attempts, 3); channel.close();
  for (const error of [Error('Unable to exec'), Error('Connection lost'), Object.assign(Error('(SSH) Channel open failure: unsupported'), {reason: 3})]) {
    attempts = 0; client.exec = (_command, callback) => { attempts++; callback(error); };
    await assert.rejects(pool.open('exec', ['mutation']), error); assert.equal(attempts, 1);
  }
});

test('closing a connection rejects queued requests and prevents further channel opens', async () => {
  const client = new Client(), pool = new SessionChannels(client);
  const running = await Promise.all([1, 2, 3].map(n => pool.open('exec', [String(n)])));
  const queued = pool.open('exec', ['queued']), rejected = assert.rejects(queued, {code: 'SSH_CLOSED'});
  client.emit('close'); await rejected; await assert.rejects(pool.open('exec', ['after-close']), {code: 'SSH_CLOSED'});
  for (const channel of running) channel.close(); assert.equal(client.calls.length, 3);
});

async function encrypted(t, options) {
  const root = await mkdtemp(join(tmpdir(), 'ssh-channel-test-')); await mkdir(join(root, 'folder'));
  const server = await sshFixture(root, options), store = new ConfigStore(join(root, 'config')); await store.init();
  await store.save(`Host limited\n HostName 127.0.0.1\n Port ${server.port}\n User tester\n IdentityAgent none\n`, (await store.get()).revision);
  await store.pin(`[127.0.0.1]:${server.port}`, fingerprintOf(ssh2.utils.parseKey(server.key).getPublicSSH()));
  const mounts = new Mounts(store), connection = await mounts.connect('limited', {limited: {password: 'test-password'}});
  t.after(async () => { mounts.dispose(); await server.close(); });
  return {mounts, connection, server};
}

test('encrypted SSH reproduces MaxSessions open failed, then queued exec/SFTP bursts recover automatically', async t => {
  const f = await encrypted(t, {maxSessions: 2, onExec: (_command, stream) => { setTimeout(() => { stream.write('OK'); stream.exit(0); stream.end(); }, 40); }});
  const raw = () => new Promise((resolve, reject) => f.connection.client.exec('raw', (error, stream) => error ? reject(error) : resolve(stream)));
  const first = await raw(), second = await raw(); first.resume(); second.resume();
  await assert.rejects(raw(), /Channel open failure:/);
  await Promise.all([first, second].map(channel => new Promise(resolve => channel.once('close', resolve))));
  const results = await Promise.all(Array.from({length: 36}, (_, n) => n % 4 === 0 ? browse(f.connection, '/folder') : exec(f.connection, 'read-' + n)));
  assert.equal(results.length, 36); assert.equal(f.server.peakSessions, 2); assert.ok(f.server.refusedCount > 0);
});

test('side-panel tree/watch bursts recover transient SSH refusal and each mutation executes once', async t => {
  let mutations = 0;
  const f = await encrypted(t, {maxSessions: 2, refuseSessions: 2, onExec: (_command, stream) => {
    let raw = ''; stream.on('data', chunk => raw += chunk); stream.once('end', () => {
      const query = JSON.parse(raw); if (query.op === 'fs.createFile') mutations++;
      setTimeout(() => { stream.write(JSON.stringify({ok: true, value: {path: query.path, entries: []}})); stream.exit(0); stream.end(); }, 30);
    });
  }});
  const record = {id: 'r', alias: 'limited', remoteRoot: '/project', localRoot: join(tmpdir(), 'ssh-sidebar-limit')}; f.mounts.records.push(record);
  const session = {id: 's', header: {cwd: record.localRoot}};
  const adapter = new SidebarAdapter({workingDirectory: {get: () => record.localRoot}, sandboxPolicy: {resolve: () => ({mode: 'workspace-write'})}}, f.mounts);
  const result = await Promise.all(Array.from({length: 40}, (_, n) => adapter.request({record, session}, n % 2 ? 'fs.tree' : 'fs.watch', {path: '/project/folder-' + n})));
  assert.equal(result.length, 40); assert.equal(result[13].path, '/project/folder-13');
  await adapter.request({record, session}, 'fs.createFile', {path: '/project', name: 'created.txt'});
  assert.equal(mutations, 1); assert.ok(f.server.refusedCount >= 2); assert.ok(f.server.peakSessions <= 2);
});

test('operation deadlines include time waiting for an SSH channel', async t => {
  const f = await encrypted(t, {onExec: () => {}});
  const controls = [new AbortController(), new AbortController(), new AbortController()];
  const occupied = controls.map(control => exec(f.connection, 'hang', {signal: control.signal}).catch(() => {}));
  await new Promise(resolve => setTimeout(resolve, 50));
  await assert.rejects(exec(f.connection, 'queued', {timeout: 30}), {code: 'REMOTE_TIMEOUT'});
  await assert.rejects(browse(f.connection, '/', {timeout: 30}), {code: 'SFTP_TIMEOUT'});
  for (const control of controls) control.abort(); await Promise.all(occupied);
  assert.equal(f.server.execCount, 3);
});

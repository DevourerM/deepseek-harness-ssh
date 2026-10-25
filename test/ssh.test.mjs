import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {ConfigStore} from '../src/host/config.js';
import {SshConnector, browse, exec, forward, nodeCommand} from '../src/host/ssh.js';
import {RemoteManager} from '../src/host/manager.js';
import {sshFixture, decodeCommand} from './ssh-fixture.mjs';

async function setup(t, options) {
  const base = join(import.meta.dirname, '../artifacts/tests'); await mkdir(base, {recursive: true});
  const root = await mkdtemp(join(base, 'ssh-')); await mkdir(join(root, 'project 空格')); await writeFile(join(root, 'readme.txt'), 'not a directory');
  const server = await sshFixture(root, options); const store = new ConfigStore(join(root, 'config')); await store.init();
  await store.save(`Host loopback\n HostName 127.0.0.1\n User tester\n Port ${server.port}\n IdentityAgent none\n ConnectTimeout 2`, (await store.get()).revision);
  const connector = new SshConnector(store); t.after(async () => { connector.dispose(); await server.close(); await rm(root, {recursive: true, force: true}); });
  const secrets = {loopback: {password: 'test-password'}};
  const trust = async () => { const e = await connector.connect('loopback', secrets).catch(e => e); assert.equal(e.code, 'HOST_KEY_UNKNOWN', e.message); await connector.trust(e.details.challengeId); return e; };
  return {root, server, store, connector, secrets, trust};
}
test('real SSH handshake requires explicit trust, pins host key, rejects bad authentication', async t => {
  const f = await setup(t); const unknown = await f.trust(); assert.match(unknown.details.fingerprint, /^SHA256:/);
  assert.throws(() => f.connector.trust(unknown.details.challengeId), {code: 'TRUST_EXPIRED'});
  await assert.rejects(f.connector.connect('loopback', {loopback: {password: 'wrong'}}), {code: 'SSH_CONNECT'});
  const c = await f.connector.connect('loopback', f.secrets); assert.equal((await exec(c, 'fixture')).stdout, 'SSH_FIXTURE_OK'); c.close();
  await f.store.forget(unknown.details.endpoint); await f.store.pin(unknown.details.endpoint, 'SHA256:wrong');
  await assert.rejects(f.connector.connect('loopback', f.secrets), {code: 'HOST_KEY_CHANGED'});
  assert.equal(f.server.execCount, 1);
});
test('real SFTP resolves Unicode directories, filters files and validates paths', async t => {
  const f = await setup(t); await f.trust(); const c = await f.connector.connect('loopback', f.secrets);
  const listed = await browse(c, '~'); assert.equal(listed.path, '/'); assert.ok(listed.directories.some(e => e.name === 'project 空格')); assert.ok(!listed.directories.some(e => e.name === 'readme.txt'));
  assert.equal((await browse(c, '/project 空格')).path, '/project 空格');
  await assert.rejects(browse(c, '/readme.txt'), {code: 'NOT_DIRECTORY'}); await assert.rejects(browse(c, '\u0000bad'), {code: 'PATH_INVALID'}); c.close();
});
test('real SSH direct-tcpip tunnel carries HTTP and closes listener', async t => {
  const f = await setup(t); await f.trust(); const c = await f.connector.connect('loopback', f.secrets);
  const http = createServer((req, res) => res.end('remote HTTP over encrypted SSH'));
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve)); t.after(() => http.close());
  const tunnel = await forward(c); tunnel.setRemote(http.address().port);
  const url = `http://127.0.0.1:${tunnel.port}/`;
  assert.equal(await (await fetch(url)).text(), 'remote HTTP over encrypted SSH'); tunnel.close(); c.close();
  await assert.rejects(fetch(url));
});
test('remote execution is bounded, cancellable, and shell data cannot become commands', async t => {
  const f = await setup(t, {onExec: (command, stream) => { if (command === 'overflow') { stream.write('x'.repeat(100)); stream.exit(0); stream.end(); } }});
  await f.trust(); const c = await f.connector.connect('loopback', f.secrets);
  await assert.rejects(exec(c, 'overflow', {maxBytes: 10}), {code: 'OUTPUT_LIMIT'});
  await assert.rejects(exec(c, 'hang', {timeout: 50}), {code: 'REMOTE_TIMEOUT'});
  const ac = new AbortController(), task = exec(c, 'hang', {signal: ac.signal}); setTimeout(() => ac.abort(Error('cancel')), 30); await assert.rejects(task, /cancel/); c.close();
  const payload = "/space dir/中文/' ; $(touch /bad) `evil`";
  const decoded = decodeCommand(nodeCommand({nodePath: '/usr/bin/node path'}, value => value, [payload]));
  assert.equal(decoded.node, '/usr/bin/node path'); assert.equal(eval(decoded.script), payload);
});
test('jump host is another pinned encrypted SSH connection', async t => {
  const f = await setup(t); const gateway = await sshFixture(f.root); t.after(() => gateway.close());
  const config = await f.store.get();
  await f.store.save(config.text + `\n ProxyJump gateway\nHost gateway\n HostName 127.0.0.1\n Port ${gateway.port}\n User tester\n IdentityAgent none`, config.revision);
  const secrets = {...f.secrets, gateway: {password: 'test-password'}};
  for (let i = 0; i < 2; i++) { const error = await f.connector.connect('loopback', secrets).catch(e => e); assert.equal(error.code, 'HOST_KEY_UNKNOWN'); await f.connector.trust(error.details.challengeId); }
  const c = await f.connector.connect('loopback', secrets); assert.equal((await exec(c, 'fixture')).stdout, 'SSH_FIXTURE_OK'); c.close();
});
test('manager checks SSH + SFTP + runtime, and exposes background errors without secrets', async t => {
  const f = await setup(t, {onExec: (_command, stream) => { stream.write('DSH_SSH_JSON:' + JSON.stringify({platform: 'linux', node: '24.0.0', installed: true, installedVersion: '0.2.1-rc.3'})); stream.exit(0); stream.end(); }});
  await f.trust(); const manager = new RemoteManager(f.store); t.after(() => manager.dispose());
  const result = await manager.check('loopback', f.secrets); assert.equal(result.ready, true); assert.equal(result.sftp, true);
  const {jobId} = manager.job('check', {alias: 'loopback', secrets: {loopback: {password: 'do-not-print'}}});
  let job; do { await new Promise(r => setTimeout(r, 25)); job = manager.poll(jobId); } while (!job.done);
  assert.equal(job.error.code, 'SSH_CONNECT'); assert.ok(!JSON.stringify(job).includes('do-not-print'));
});

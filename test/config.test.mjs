import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ConfigStore, parseConfig, DEFAULT_CONFIG} from '../src/host/config.js';

test('OpenSSH style: quoted paths, equals, first-value defaults and jump aliases', () => {
  const hosts = parseConfig(`Host work backup\n HostName=::1\n User "name with space"\n Port = 2200\n IdentityFile "C:\\My Keys\\id_ed25519" # comment\n ProxyJump jump\nHost jump\n HostName gateway.example\nHost *\n ConnectTimeout 9\n ServerAliveInterval 20`);
  assert.equal(hosts.length, 3); assert.equal(hosts[0].identityFile, 'C:\\My Keys\\id_ed25519');
  assert.equal(hosts[0].hostname, '::1'); assert.equal(hosts[0].port, 2200); assert.equal(hosts[0].timeout, 9000);
  assert.equal(hosts[2].keepalive, 20000); assert.equal(hosts[0].identityAgent, 'none');
  assert.deepEqual(parseConfig(DEFAULT_CONFIG), []);
});
test('config rejects executable directives, cycles, invalid ports and malformed input', () => {
  for (const text of ['Host x\nProxyCommand evil', 'Host x\nInclude other', 'Host x\nPort -1', 'Host x\nPort 22.5', 'Host x\nHostName -bad', 'Host x\nHostName "unclosed', 'Host x\nProxyJump y\nHost y\nProxyJump x', 'Host x\nProxyJump missing', 'Host x\nUser "a\u0000b"', 'Host a?\nUser me']) assert.throws(() => parseConfig(text), {code: 'CONFIG_INVALID'}, text);
});
test('atomic config saves, optimistic conflict protection and independent host keys', async t => {
  const base = join(import.meta.dirname, '../artifacts/tests'); await mkdir(base, {recursive: true});
  const root = await mkdtemp(join(base, 'config-')); t.after(() => rm(root, {recursive: true, force: true}));
  const store = new ConfigStore(root); await store.init(); const original = await store.get();
  const saved = await store.save('Host demo\n HostName 127.0.0.1\n', original.revision);
  assert.notEqual(saved.revision, original.revision);
  await assert.rejects(store.save('Host other', original.revision), {code: 'CONFIG_CONFLICT'});
  await store.pin('[example]:22', 'SHA256:first'); await assert.rejects(store.pin('[example]:22', 'SHA256:changed'), {code: 'HOST_KEY_CHANGED'});
  assert.deepEqual(await store.known(), {'[example]:22': 'SHA256:first'});
  await store.forget('[example]:22'); assert.deepEqual(await store.known(), {});
  assert.equal(await readFile(store.path, 'utf8'), saved.text);
});
test('authMode, preferredAuthentications, transport, maxSessions and setHostAuth', async t => {
  const hosts = parseConfig(`Host entry\n HostName entry.nju.edu.cn\n User js_geqj/10.1.0.102/self\n AuthMode 2fa\n Transport auto\n MaxSessions 3\nHost custom\n HostName 10.0.0.2\n PreferredAuthentications keyboard-interactive,password`);
  assert.equal(hosts[0].authMode, '2fa');
  assert.deepEqual(hosts[0].preferredAuthentications, ['keyboard-interactive', 'password']);
  assert.equal(hosts[0].transport, 'auto');
  assert.equal(hosts[0].maxSessions, 3);
  assert.deepEqual(hosts[1].preferredAuthentications, ['keyboard-interactive', 'password']);
  for (const bad of ['Host x\n AuthMode magic', 'Host x\n PreferredAuthentications invalid', 'Host x\n Transport pty', 'Host x\n MaxSessions 99']) {
    assert.throws(() => parseConfig(bad), {code: 'CONFIG_INVALID'}, bad);
  }
  const base = join(import.meta.dirname, '../artifacts/tests'); await mkdir(base, {recursive: true});
  const root = await mkdtemp(join(base, 'auth-config-')); t.after(() => rm(root, {recursive: true, force: true}));
  const store = new ConfigStore(root); await store.init();
  const initial = await store.get();
  const s1 = await store.save(`# comment\nHost entry\n  HostName entry.nju.edu.cn\n  User tester\nHost direct\n  HostName 127.0.0.1\n`, initial.revision);
  const s2 = await store.setHostAuth('entry', '2fa', s1.revision);
  assert.equal(s2.hosts[0].authMode, '2fa');
  assert.equal(s2.hosts[1].authMode, 'auto');
  assert.ok(s2.text.includes('# comment'));
  await assert.rejects(store.setHostAuth('entry', 'publickey', s1.revision), {code: 'CONFIG_CONFLICT'});
});

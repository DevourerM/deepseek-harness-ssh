import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createServer as createTcpServer} from 'node:net';
import {generateKeyPairSync} from 'node:crypto';
import ssh2 from 'ssh2';
import {inflateSync} from 'node:zlib';
import {ConfigStore} from '../src/host/config.js';
import {LocalManager} from '../src/host/local-manager.js';
import {RemoteProcesses} from '../src/host/processes.js';
import {RemoteTerminals} from '../src/host/terminals.js';
import {SshConnector, browse, exec, forward, nodeCommand} from '../src/host/ssh.js';
import {getShellTransport} from '../src/host/shell-transport.js';
import {RemoteManager} from '../src/host/manager.js';
import {sshFixture, decodeCommand} from './ssh-fixture.mjs';

function readShellRequest(line, chunks, stream) {
  assert.ok(Buffer.byteLength(line) <= 512, 'gateway terminal lines must stay short');
  const prefix = '__DSH_CHUNK__:';
  if (line.startsWith(prefix)) { chunks.push(line.slice(prefix.length)); stream.write('__DSH_RPC_PART_OK__\r\n'); return; }
  if (line.startsWith('__DSH_FINAL__:')) {
    const [, encoding, chunk] = line.split(':');
    const payload = Buffer.from(chunks.splice(0).join('') + chunk, 'base64');
    return JSON.parse((encoding === 'z' ? inflateSync(payload) : payload).toString());
  }
  if (line.startsWith('{')) return JSON.parse(line);
}

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
  await assert.rejects(f.connector.connect('loopback', {loopback: {password: 'wrong'}}), {code: 'SSH_AUTH_FAILED'});
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
  assert.equal(job.error.code, 'SSH_AUTH_FAILED'); assert.ok(!JSON.stringify(job).includes('do-not-print'));
});
test('managed remote launch, canonical reuse, saved bookmarks and disconnect lifecycle', async t => {
  const http = createServer((req, res) => res.end('managed remote Host'));
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve)); t.after(() => http.close());
  const f = await setup(t, {onExec: (_command, stream) => {
    stream.write(`dsh web: http://127.0.0.1:${http.address().port}/?token=fixture-launch-token\n`);
    stream.once('end', () => { stream.exit(0); stream.end(); });
  }});
  await f.trust(); const manager = new RemoteManager(f.store); t.after(() => manager.dispose());
  const opened = await manager.open('loopback', '/project 空格', f.secrets);
  assert.equal(opened.state, 'connected'); assert.equal(await (await fetch(opened.url)).text(), 'managed remote Host');
  assert.equal((await manager.open('loopback', '/project 空格', f.secrets)).id, opened.id);
  assert.equal((await f.store.bookmarks())[0].path, '/project 空格');
  assert.ok(!JSON.stringify(manager.list()).includes('fixture-launch-token'));
  assert.ok(!(await readConfig(f.store)).includes('test-password'));
  manager.disconnect(opened.id); assert.equal(manager.get(opened.id).state, 'disconnected'); assert.equal(manager.get(opened.id).url, undefined);
  await assert.rejects(fetch(opened.url));
});
async function readConfig(store) { return (await store.get()).text; }
test('encrypted identity file authentication uses an ephemeral passphrase', async t => {
  const key = generateKeyPairSync('rsa', {modulusLength: 2048}).privateKey.export({format: 'pem', type: 'pkcs1', cipher: 'aes-256-cbc', passphrase: 'ephemeral-key-passphrase'});
  const authorizedKey = ssh2.utils.parseKey(key, 'ephemeral-key-passphrase').getPublicSSH();
  const f = await setup(t, {authorizedKey}); await f.trust(); const path = join(f.root, 'identity with spaces'); await writeFile(path, key, {mode: 0o600});
  const config = await f.store.get(); await f.store.save(config.text + `\n IdentityFile "${path}"`, config.revision);
  await assert.rejects(f.connector.connect('loopback', {loopback: {passphrase: 'wrong'}}));
  const c = await f.connector.connect('loopback', {loopback: {passphrase: 'ephemeral-key-passphrase'}});
  assert.equal((await exec(c, 'fixture')).stdout, 'SSH_FIXTURE_OK'); c.close();
  const prompts = [];
  const interactive = await f.connector.connect('loopback', {}, undefined, {onChallenge: info => {
    prompts.push(info.kind); return ['ephemeral-key-passphrase'];
  }});
  assert.deepEqual(prompts, ['passphrase']); interactive.close();
  assert.ok(!(await readConfig(f.store)).includes('ephemeral-key-passphrase'));
});
test('failed remote startup cleans resources and redacts launch tokens from errors', async t => {
  const f = await setup(t, {onExec: (_command, stream) => { stream.stderr.write('failed URL ?token=secret-value\n'); stream.exit(1); stream.end(); }});
  await f.trust(); const manager = new RemoteManager(f.store); t.after(() => manager.dispose());
  const error = await manager.open('loopback', '/project 空格', f.secrets).catch(e => e);
  assert.equal(error.code, 'HOST_EXITED'); assert.ok(!error.message.includes('secret-value')); assert.equal(manager.list()[0].state, 'disconnected');
});
test('missing password produces an actionable prompt, failed passwords never appear in errors', async t => {
  const f = await setup(t); await f.trust();
  const error = await f.connector.connect('loopback').catch(e => e);
  assert.equal(error.code, 'SSH_AUTH_REQUIRED'); assert.equal(error.details.alias, 'loopback'); assert.equal(error.details.kind, 'password');
  const failed = await f.connector.connect('loopback', {loopback: {password: 'a-secret-wrong-password'}}).catch(e => e);
  assert.equal(failed.code, 'SSH_AUTH_FAILED'); assert.ok(!JSON.stringify(failed).includes('a-secret-wrong-password'));
});
test('keyboard-interactive password servers accept a supplied password and reject missing input', async t => {
  const f = await setup(t, {keyboardOnly: true}); await f.trust();
  await assert.rejects(f.connector.connect('loopback'), {code: 'SSH_AUTH_REQUIRED'});
  await assert.rejects(f.connector.connect('loopback', {loopback: {password: 'wrong'}}), {code: 'SSH_AUTH_FAILED'});
  const c = await f.connector.connect('loopback', f.secrets); assert.equal((await exec(c, 'fixture')).stdout, 'SSH_FIXTURE_OK'); c.close();
  assert.equal(f.server.answers.filter(answer => answer[0] === 'wrong').length, 1, 'no automatic wrong-password retries');
});
test('keyboard-interactive verification codes never receive the login password', async t => {
  for (const interactivePrompt of ['Verification code: ', 'One-time password: ']) {
    const f = await setup(t, {keyboardOnly: true, interactivePrompt}); await f.trust();
    await assert.rejects(f.connector.connect('loopback', f.secrets), {code: 'SSH_INTERACTIVE_UNSUPPORTED'});
    assert.ok(f.server.answers.every(answer => !answer.includes('test-password')));
  }
});
test('two-step keyboard-interactive 2FA pauses live handshake and prefers keyboard-interactive over bare password', async t => {
  const f = await setup(t, {
    alsoOfferPassword: true,
    keyboardSteps: [
      {prompts: [{prompt: 'Password: ', echo: false}], expected: ['test-password']},
      {prompts: [{prompt: '2nd Password: ', echo: false}], expected: ['654321']}
    ]
  });
  await f.trust();
  const seen = [];
  const c = await f.connector.connect('loopback', {}, undefined, {
    onChallenge: async challenge => {
      seen.push(challenge.prompts.map(p => p.prompt));
      return seen.length === 1 ? ['test-password'] : ['654321'];
    }
  });
  assert.deepEqual(seen, [['Password: '], ['2nd Password: ']]);
  assert.equal(f.server.passwordAttempts, 0, 'must not burn password lockout attempt when keyboard-interactive is available');
  assert.equal((await exec(c, 'fixture')).stdout, 'SSH_FIXTURE_OK');
  c.close();
});
test('single-round dual-prompt keyboard-interactive pre-fills password and prompts only for OTP', async t => {
  const f = await setup(t, {
    keyboardSteps: [
      {prompts: [{prompt: 'Password: ', echo: false}, {prompt: '2nd Password: ', echo: false}], expected: ['test-password', '246810']}
    ]
  });
  await f.trust();
  const seen = [];
  const c = await f.connector.connect('loopback', f.secrets, undefined, {
    onChallenge: async challenge => { seen.push(challenge.prompts.map(p => p.prompt)); return ['246810']; }
  });
  assert.deepEqual(seen, [['2nd Password: ']]);
  assert.equal((await exec(c, 'fixture')).stdout, 'SSH_FIXTURE_OK');
  c.close();
});
test('Jobs challenge-reply bridges two-step 2FA and sessionStatus isolates local vs SSH sessions', async t => {
  const f = await setup(t, {
    alsoOfferPassword: true,
    keyboardSteps: [
      {prompts: [{prompt: 'Password: ', echo: false}], expected: ['test-password']},
      {prompts: [{prompt: '2nd Password: ', echo: false}], expected: ['112233']}
    ],
    onExec: (_command, stream) => { stream.write('3.11.0\n'); stream.exit(0); stream.end(); }
  });
  await f.trust();
  const sessionsMap = new Map([['local-sess', {id: 'local-sess', header: {cwd: f.root}}]]);
  const workspaces = new Map();
  const ctx = {
    sessions: {get: id => sessionsMap.get(id)},
    workspaceRegistry: {
      get: id => workspaces.get(id),
      async create(p, title) { const w = {id: 'w1', path: p, title, sessionIds: [], async setTitle(v) { this.title = v; }}; workspaces.set(w.id, w); return w; }
    }
  };
  const manager = new LocalManager(f.store, ctx);
  t.after(() => manager.dispose());
  await manager.init();
  assert.deepEqual(manager.mounts.sessionStatus('local-sess'), {ssh: false});
  const {jobId} = manager.job('check', {alias: 'loopback'});
  for (const answer of ['test-password', '112233']) {
    let snapshot;
    for (let i = 0; i < 60; i++) {
      snapshot = manager.poll(jobId);
      if (snapshot.challenge) break;
      await new Promise(r => setTimeout(r, 20));
    }
    assert.ok(snapshot.challenge, 'expected interactive challenge');
    assert.ok(!JSON.stringify(snapshot).includes('test-password'));
    manager.replyChallenge(jobId, snapshot.challenge.id, [answer]);
  }
  let done;
  for (let i = 0; i < 60; i++) {
    done = manager.poll(jobId);
    if (done.done) break;
    await new Promise(r => setTimeout(r, 20));
  }
  assert.equal(done.error, undefined);
  assert.equal(done.result.ready, true);
  assert.equal(done.result.python, '3.11.0');
  const opened = await manager.open('loopback', '/project 空格');
  sessionsMap.set('ssh-sess', {id: 'ssh-sess', header: {cwd: opened.localRoot}});
  const status = manager.mounts.sessionStatus('ssh-sess');
  assert.equal(status.ssh, true);
  assert.equal(status.alias, 'loopback');
  assert.equal(status.state, 'connected');
});
test('Transport auto falls back to single-channel ShellTransport when bastion rejects exec', async t => {
  const f = await setup(t, {
    execDisabled: true,
    onShell: stream => {
      stream.write('Welcome to NJU Bastion (TERM-SSHD)\r\nlogin2$ ');
      let buf = '', rpcMode = false;
      const chunks = [];
      stream.on('data', chunk => {
        buf += chunk.toString('utf8');
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).replace(/\r$/, '').trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          const m = line.match(/printf '\\n(__DSH_SH_[^']+__)\\n'/);
          if (m) { stream.write(`\n${m[1]}\r\n`); continue; }
          if (!rpcMode && line.startsWith('python3 -u -c')) { rpcMode = true; stream.write('__DSH_LOADER_READY__\r\n'); continue; }
          if (line === '__DSH_EOF__') { stream.write('__DSH_WORKER_READY__\r\n'); continue; }
          if (rpcMode && /^[A-Za-z0-9+/]+=*$/.test(line)) { stream.write('__DSH_PART_OK__\r\n'); continue; }
          if (rpcMode) {
            const req = readShellRequest(line, chunks, stream);
            if (!req) continue;
            if (req.op === 'init_file') stream.write(`__DSH_RPC__:${JSON.stringify({id: req.id, ok: true, value: true})}\n`);
            else if (req.op === 'ping') stream.write(`__DSH_RPC__:${JSON.stringify({id: req.id, ok: true, value: {python: '3.9.21'}})}\n`);
            else if (req.op === 'browse') stream.write(`__DSH_RPC__:${JSON.stringify({id: req.id, ok: true, value: {path: req.path === '.' ? '/' : req.path, directories: []}})}\n`);
            else if (req.op === 'file') stream.write(`__DSH_RPC__:${JSON.stringify({id: req.id, ok: true, value: {ok: true, value: {type: 'file', size: 5, version: '1:5:0:0'}}})}\n`);
            else if (req.op === 'exec_start') {
              stream.write(`__DSH_RPC__:${JSON.stringify({id: req.id, ok: true, value: {pid: 999}})}\n`);
              stream.write(`__DSH_RPC__:${JSON.stringify({id: req.id, event: 'stdout', data: Buffer.from('SHELL_EXEC_OK\n').toString('base64')})}\n`);
              stream.write(`__DSH_RPC__:${JSON.stringify({id: req.id, event: 'exit', exitCode: 0})}\n`);
            }
          }
        }
      });
    }
  });
  await f.trust();
  const ctx = {workspaceRegistry: {async create(p, title) { return {id: 'w-sh', path: p, title, sessionIds: [], async setTitle(v) { this.title = v; }}; }}};
  const manager = new LocalManager(f.store, ctx);
  t.after(() => manager.dispose());
  await manager.init();
  const res = await manager.check('loopback', f.secrets);
  assert.equal(res.ready, true);
  assert.equal(res.transport, 'shell');
  assert.equal(res.python, '3.9.21');
  const opened = await manager.open('loopback', '/project 空格', f.secrets);
  const stat = await manager.mounts.request(opened, {action: 'stat', path: '/project 空格/a.txt'});
  assert.equal(stat.type, 'file');
  const processes = new RemoteProcesses(manager.mounts);
  t.after(() => processes.dispose());
  const out = await processes.execute(opened, 'echo hi', opened.localRoot);
  assert.equal(out.exitCode, 0);
  assert.equal(out.stdout, 'SHELL_EXEC_OK\n');
});
test('connectTcp falls back to RFC1035 DNS-over-TCP when system getaddrinfo fails while pinning original hostname', async t => {
  const f = await setup(t);
  let dnsQueries = 0;
  const dnsServer = createTcpServer(socket => {
    let buf = Buffer.alloc(0);
    socket.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < 2) return;
      const len = buf.readUInt16BE(0);
      if (buf.length < 2 + len) return;
      dnsQueries++;
      const req = buf.subarray(2, 2 + len);
      const id = req.subarray(0, 2);
      const question = req.subarray(12);
      const header = Buffer.concat([id, Buffer.from([0x81, 0x80, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00])]);
      const answer = Buffer.from([0xc0, 0x0c, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x3c, 0x00, 0x04, 127, 0, 0, 1]);
      const payload = Buffer.concat([header, question, answer]);
      const frame = Buffer.alloc(2 + payload.length);
      frame.writeUInt16BE(payload.length, 0);
      payload.copy(frame, 2);
      socket.end(frame);
    });
  });
  await new Promise(resolve => dnsServer.listen(0, '127.0.0.1', resolve));
  t.after(() => dnsServer.close());
  const dnsPort = dnsServer.address().port;
  const cfg = await f.store.get();
  await f.store.save(`${cfg.text}\nHost dnsfallback\n  HostName fake-unresolvable.invalid\n  User tester\n  Port ${f.server.port}\n  IdentityAgent none\n  ConnectTimeout 2\n`, cfg.revision);
  const dnsOptions = {servers: ['127.0.0.1'], port: dnsPort};
  const unknown = await f.connector.connect('dnsfallback', {dnsfallback: {password: 'test-password'}}, undefined, {dnsOptions}).catch(e => e);
  assert.equal(unknown.code, 'HOST_KEY_UNKNOWN');
  assert.equal(unknown.details.endpoint, `[fake-unresolvable.invalid]:${f.server.port}`);
  await f.connector.trust(unknown.details.challengeId);
  const c = await f.connector.connect('dnsfallback', {dnsfallback: {password: 'test-password'}}, undefined, {dnsOptions});
  assert.equal((await exec(c, 'fixture')).stdout, 'SSH_FIXTURE_OK');
  assert.ok(dnsQueries >= 1);
  c.close();
});
test('partialSuccess keyboard-interactive -> password Step 2 prompts only OTP without leaking credentials', async t => {
  const f = await setup(t, {
    keyboardSteps: [{prompts: [{prompt: 'Password: ', echo: false}], expected: ['step1-secret']}],
    partialPasswordOtp: '888999'
  });
  await f.trust();
  const cfg = await f.store.get();
  await f.store.save(cfg.text.replace('ConnectTimeout 2', 'AuthMode 2fa\n  ConnectTimeout 2'), cfg.revision);
  const bad = await f.connector.connect('loopback', {loopback: {password: 'step1-secret', otp: 'wrong-otp'}}).catch(e => e);
  assert.equal(bad.code, 'SSH_AUTH_FAILED');
  assert.equal(bad.details.kind, 'otp');
  assert.equal(bad.details.trace, undefined);
  assert.ok(!JSON.stringify(bad.details).includes('step1-secret'));
  assert.ok(!JSON.stringify(bad.details).includes('wrong-otp'));
  const prompts = [];
  const conn = await f.connector.connect('loopback', {}, undefined, {
    onChallenge: info => {
      prompts.push(info.prompts[0].prompt);
      return [prompts.length === 1 ? 'step1-secret' : '888999'];
    }
  });
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /Password/);
  assert.match(prompts[1], /2nd Password/);
  conn.close();
});
test('password-only SSH requests credentials on the live connection', async t => {
  const fixture = await setup(t);
  await fixture.trust();
  const challenges = [];
  const connection = await fixture.connector.connect('loopback', {}, undefined, {
    onChallenge: info => { challenges.push(info.kind); return ['test-password']; }
  });
  assert.deepEqual(challenges, ['password']);
  assert.equal(fixture.server.passwordAttempts, 1);
  connection.close();
});

function terminalBastion(onRequest) {
  return {
    terminalBastion: true, ptyRequired: true, maxSessions: 1,
    keyboardSteps: [{prompts: [{prompt: 'Password: ', echo: false}], expected: ['test-password']}],
    onShell(stream) {
      let state = 'otp', input = '';
      const chunks = [];
      stream.write('\x1b[33m2nd Pass');
      stream.write('word:\x1b[0m');
      stream.on('data', chunk => {
        input += chunk.toString();
        let newline;
        while ((newline = input.indexOf('\n')) >= 0) {
          const line = input.slice(0, newline).trim(); input = input.slice(newline + 1);
          if (state === 'otp') {
            if (line !== '123456') { stream.end(); return; }
            state = 'marker'; stream.write('\r\nlogin2$ '); continue;
          }
          if (state === 'marker') {
            const marker = line.match(/__DSH_SH_\w+__/);
            if (marker) { state = 'loader'; stream.write('\r\n' + marker[0] + '\r\n'); }
            continue;
          }
          if (state === 'loader') {
            assert.match(line, /^python3 -u -c /);
            state = 'worker'; stream.write('__DSH_LOADER_READY__\r\n'); continue;
          }
          if (state === 'worker') {
            if (line === '__DSH_EOF__') { state = 'rpc'; stream.write('__DSH_WORKER_READY__\r\n'); }
            else { assert.ok(line.length <= 384); assert.match(line, /^[A-Za-z0-9+/]+=*$/); stream.write('__DSH_PART_OK__\r\n'); }
            continue;
          }
          const request = readShellRequest(line, chunks, stream);
          if (!request) continue;
          const send = value => stream.write('__DSH_RPC__:' + JSON.stringify(value) + '\r\n');
          onRequest?.(request, send);
        }
      });
    }
  };
}

test('TERM-SSHD completes shell OTP, then shares one channel for files, commands and terminals', async t => {
  const operations = [];
  const fileInit = Promise.withResolvers();
  let finishFileInit;
  let terminalId;
  const fixture = await setup(t, terminalBastion((request, send) => {
    operations.push(request.op);
    const reply = value => send({id: request.id, ok: true, value});
    const output = (id, value) => send({id, event: 'stdout', data: Buffer.from(value).toString('base64')});
    if (request.op === 'ping') reply({python: '3.12'});
    if (request.op === 'init_file') {
      assert.match(request.source, /def main/);
      finishFileInit = () => reply(true);
      fileInit.resolve();
    }
    if (request.op === 'browse') reply({path: '/fixture', directories: []});
    if (request.op === 'file') reply({ok: true, value: 'fixture file'});
    if (request.op === 'exec_start') {
      reply({pid: 12});
      if (request.spec.argv[0] === 'python3') {
        terminalId = request.id;
        output(terminalId, '{"type":"ready","pid":12}\n');
      } else {
        output(request.id, 'command output');
        send({id: request.id, event: 'exit', exitCode: 0});
      }
    }
    if (request.op === 'exec_stdin') {
      reply(true);
      if (request.data) {
        const frame = JSON.parse(Buffer.from(request.data, 'base64').toString());
        output(terminalId, JSON.stringify({type: 'reply', id: frame.id, value: true}) + '\n');
        if (frame.op === 'terminate') {
          output(terminalId, '{"type":"exit","exitCode":0}\n');
          send({id: terminalId, event: 'exit', exitCode: 0});
        }
      }
    }
    if (request.op === 'exec_kill') reply(true);
  }));
  await fixture.trust();
  const manager = new LocalManager(fixture.store, {});
  t.after(() => manager.dispose());
  const prompts = [];
  const checked = await manager.check('loopback', {}, undefined, {onChallenge: info => {
    prompts.push(info.prompts[0].prompt.trim());
    assert.equal(manager.mounts.connections.has('loopback'), false);
    return [prompts.length === 1 ? 'test-password' : '123456'];
  }});
  assert.deepEqual(prompts, ['Password:', '2nd Password:']);
  assert.equal(checked.transport, 'shell');
  assert.equal(checked.python, '3.12');
  assert.deepEqual(operations, ['ping', 'browse']);
  const connection = manager.mounts.connections.get('loopback');
  const worker = getShellTransport(connection.client);
  await assert.rejects(worker.rpc('test_no_reply', {}, {timeout: 25}), {code: 'REMOTE_TIMEOUT'});
  assert.equal(manager.mounts.connections.get('loopback'), connection);
  assert.equal((await worker.browse('/fixture')).path, '/fixture');
  const record = {id: 'fixture', alias: 'loopback', remoteRoot: '/fixture', localRoot: fixture.root};
  manager.mounts.records.push(record);
  const processes = new RemoteProcesses(manager.mounts);
  assert.equal((await processes.execute(record, 'printf command', record.localRoot)).stdout, 'command output');
  assert.ok(!operations.includes('init_file'));
  const query = {action: 'read', path: '/fixture/file'};
  const observer = new AbortController();
  const first = manager.mounts.request(record, query, observer.signal);
  const second = manager.mounts.request(record, query);
  await fileInit.promise;
  observer.abort();
  await assert.rejects(first, {name: 'AbortError'});
  finishFileInit();
  assert.equal(await second, 'fixture file');
  assert.equal(await manager.mounts.request(record, query), 'fixture file');
  assert.equal(operations.filter(op => op === 'init_file').length, 1);
  const terminals = new RemoteTerminals(manager.mounts);
  const terminal = await terminals.spawn(record, {cwd: record.localRoot, argv: ['/bin/bash']});
  await terminal.write('echo test');
  await terminal.terminate();
  assert.equal(fixture.server.peakSessions, 1);
  assert.equal(fixture.server.execCount, 0);
});

test('TERM-SSHD rejects invalid OTP and never caches an incomplete connection', async t => {
  const fixture = await setup(t, terminalBastion());
  await fixture.trust();
  const manager = new LocalManager(fixture.store, {});
  t.after(() => manager.dispose());
  let attempts = 0;
  await assert.rejects(manager.connect('loopback', {}, undefined, {onChallenge: info => {
    attempts++;
    return [info.kind === 'otp' ? '000000' : 'test-password'];
  }}), error => error.code === 'SSH_AUTH_FAILED' && error.details.kind === 'otp');
  assert.equal(attempts, 2);
  assert.equal(manager.mounts.connections.has('loopback'), false);
});
test('TERM-SSHD cancellation at the OTP prompt closes the unfinished connection', async t => {
  const fixture = await setup(t, terminalBastion());
  await fixture.trust();
  const manager = new LocalManager(fixture.store, {});
  t.after(() => manager.dispose());
  const controller = new AbortController();
  await assert.rejects(manager.connect('loopback', {}, controller.signal, {onChallenge: info => {
    if (info.kind !== 'otp') return ['test-password'];
    controller.abort();
    return [];
  }}), {name: 'AbortError'});
  assert.equal(manager.mounts.connections.has('loopback'), false);
  assert.equal(manager.ssh.active.size, 0);
});
test('host-owned login survives observer cancellation and is shared across sessions and tools', async t => {
  const fixture = await setup(t, {keyboardOnly: true});
  await fixture.trust();
  const cwd = join(fixture.root, 'mounted');
  const sessions = new Map(['first', 'second'].map(id => [id, {header: {cwd}}]));
  const manager = new LocalManager(fixture.store, {sessions});
  t.after(() => manager.dispose());
  manager.mounts.records.push({id: 'remote', alias: 'loopback', localRoot: cwd, remoteRoot: '/fixture'});
  const input = {alias: 'loopback'};
  const {jobId} = manager.job('connect', input);
  let snapshot;
  for (let attempt = 0; attempt < 100; attempt++) {
    snapshot = manager.poll(jobId);
    if (snapshot.challenge) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.ok(snapshot.challenge);
  assert.deepEqual(manager.job('connect', {...input, background: true}), {jobId});
  assert.equal(manager.jobs.get(jobId).background, true);
  assert.equal(manager.mounts.sessionStatus('first').state, 'connecting');
  assert.equal(manager.mounts.sessionStatus('second').state, 'connecting');
  const observer = new AbortController();
  const abandoned = manager.mounts.ensure('loopback', observer.signal);
  const attached = manager.mounts.ensure('loopback');
  observer.abort();
  await assert.rejects(abandoned, {name: 'AbortError'});
  assert.equal(manager.poll(jobId).challenge.id, snapshot.challenge.id);
  manager.replyChallenge(jobId, snapshot.challenge.id, ['test-password']);
  const connection = await attached;
  assert.equal(await manager.mounts.ensure('loopback'), connection);
  assert.equal(manager.mounts.sessionStatus('first').state, 'connected');
  assert.equal(manager.mounts.sessionStatus('second').state, 'connected');
  assert.deepEqual(fixture.server.answers, [['test-password']]);
  assert.equal(fixture.server.connections.size, 1);
});
test('SFTP refusal and silent non-PTY bastion automatically fall back to PTY ShellTransport', {timeout: 15000}, async t => {
  const f = await setup(t, {
    execDisabled: true,
    sftpDisabled: true,
    ptyRequired: true,
    onShell: stream => {
      let buf = '', rpcMode = false;
      const chunks = [];
      stream.on('data', chunk => {
        buf += chunk.toString('utf8');
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).replace(/\r$/, '').trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          const m = line.match(/printf '\\n(__DSH_SH_[^']+__)\\n'/);
          if (m) { stream.write(`\n${m[1]}\r\n`); continue; }
          if (!rpcMode && line.startsWith('python3 -u -c')) { rpcMode = true; stream.write('__DSH_LOADER_READY__\r\n'); continue; }
          if (line === '__DSH_EOF__') { stream.write('__DSH_WORKER_READY__\r\n'); continue; }
          if (rpcMode && /^[A-Za-z0-9+/]+=*$/.test(line)) { stream.write('__DSH_PART_OK__\r\n'); continue; }
          if (rpcMode) {
            const req = readShellRequest(line, chunks, stream);
            if (!req) continue;
            if (req.op === 'init_file') stream.write(`__DSH_RPC__:${JSON.stringify({id: req.id, ok: true, value: true})}\n`);
            else if (req.op === 'ping') stream.write(`__DSH_RPC__:${JSON.stringify({id: req.id, ok: true, value: {python: '3.10.12'}})}\n`);
            else if (req.op === 'browse') stream.write(`__DSH_RPC__:${JSON.stringify({id: req.id, ok: true, value: {path: req.path === '.' ? '/' : req.path, directories: []}})}\n`);
          }
        }
      });
    }
  });
  await f.trust();
  const ctx = {workspaceRegistry: {async create(p, title) { return {id: 'w-pty', path: p, title, sessionIds: [], async setTitle(v) { this.title = v; }}; }}};
  const manager = new LocalManager(f.store, ctx);
  t.after(() => manager.dispose());
  await manager.init();
  const res = await manager.check('loopback', f.secrets);
  assert.equal(res.ready, true);
  assert.equal(res.transport, 'shell');
  assert.equal(res.python, '3.10.12');
});

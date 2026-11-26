import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, copyFile, writeFile, readFile, readdir, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {root, artifacts, runtimeVersion} from './env.mjs';
import {prepareHome, startHost, authenticated} from './host-fixture.mjs';
import {ConfigStore} from '../src/host/config.js';
import {Mounts} from '../src/host/mounts.js';
import {exec, quote} from '../src/host/ssh.js';
import {startSubagentSshFixture} from './subagent-ssh-fixture.mjs';

await mkdir(artifacts, {recursive: true});
const home = await mkdtemp(join(tmpdir(), 'dsh-ssh-subagent-'));
const localRoot = await realpath(process.env.DSH_SSH_VALIDATION_WORKSPACE || 'E:/中转/通用');
const localEntries = new Set(await readdir(localRoot));
let host, rpc, sessionId, connection, folder, mounts, sshFixture;
const dirs = ['', '/sub', '/relative', '/absolute', '/mapped', '/nested', '/fork', '/retarget'];
const knownFiles = ['default', 'changed', 'relative', 'absolute', 'mapped', 'nested', 'fork', 'team-first-spawn', 'team-first-fork', 'team-second-spawn', 'team-second-fork'];
function nativeRpc(auth) {
  return async (method, args) => {
    const response = await fetch(auth.origin + '/api/' + method, {
      method: 'POST', headers: {'Content-Type': 'application/json', Origin: auth.origin, Cookie: auth.cookie},
      body: JSON.stringify({type: 'client-request', rpcId: randomUUID(), method, payload: {args}}),
      signal: AbortSignal.timeout(30000),
    });
    const data = await response.json();
    if (!response.ok || !data.result?.ok) {
      const error = data.result?.error;
      throw Object.assign(Error(method + ': ' + (error?.message || response.status)), {details: error?.details});
    }
    return data.result.value;
  };
}
try {
  if (!process.env.DSH_SSH_TEST_REMOTE) sshFixture = await startSubagentSshFixture(home);
  const store = sshFixture?.store || new ConfigStore(join(artifacts, 'real-server'));
  const alias = sshFixture?.alias || (await store.get()).hosts[0].alias;
  mounts = new Mounts(store);
  if (sshFixture) {
    folder = sshFixture.folder;
    await sshFixture.makeDirs(dirs);
  } else {
    connection = await mounts.connect(alias);
    const remoteHome = (await mounts.browse(alias, '.')).path;
    folder = remoteHome + '/.dsh-ssh/validation/subagent-' + randomUUID();
    await exec(connection, 'mkdir -p ' + dirs.map(dir => quote(folder + dir)).join(' '));
  }
  await prepareHome(home, {extraPatch: '- id: sandbox-policy\n  config:\n    mode: workspace-write\n- id: agent-default-model\n  config:\n    provider: ssh-subagent-fixture\n    model: test\n- insert:\n    - id: ssh-child-fixture\n      name: ' + JSON.stringify(join(root, 'scripts/subagent-fixture.mjs').replaceAll('\\', '/')) + '\n'});
  const dataDir = join(home, 'plugins/deepseek-harness-ssh'); await mkdir(dataDir, {recursive: true});
  for (const name of ['config', 'known-hosts.json']) await copyFile(join(store.root, name), join(dataDir, name));
  host = await startHost(home);
  const initialRpc = nativeRpc(await authenticated(host.url));
  const {workspace} = await initialRpc('workspace/create', {request: {path: localRoot}});
  await host.stop();
  // Only the isolated Host maps this workspace identity to the remote fixture.
  // The workspace in the user's desktop profile and its files are untouched.
  const record = {id: 'validation', alias, localRoot: workspace.path, remoteRoot: folder, workspaceId: workspace.workspaceId};
  const mountsFile = join(dataDir, 'mounts.json');
  await writeFile(mountsFile, JSON.stringify([record]));
  host = await startHost(home);
  const auth = await authenticated(host.url); rpc = nativeRpc(auth);
  try {
    ({sessionId} = await rpc('session/create', {request: {workspaceId: workspace.workspaceId, agentPreset: 'standard'}}));
  } catch (error) {
    sessionId = error.details?.sessionId;
    throw error;
  }
  const fixture = async input => {
    const response = await fetch(auth.origin + '/api/ssh-child-test', {
      method: 'POST', headers: {'Content-Type': 'application/json', Origin: auth.origin, Cookie: auth.cookie},
      body: JSON.stringify({id: sessionId, root: folder, ...input}), signal: AbortSignal.timeout(150000),
    });
    const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data;
  };
  const readProof = async (cwd, tag) => {
    const value = await mounts.request({alias}, {action: 'read', path: cwd + '/' + tag + '.txt', limit: 1024});
    assert.equal(Buffer.from(value.data, 'base64').toString(), 'SSH_CHILD_REMOTE_OK ' + tag + '\n');
  };
  const result = await fixture({action: 'matrix'});
  const expected = {default: folder, changed: folder + '/sub', relative: folder + '/relative', absolute: folder + '/absolute', mapped: folder + '/mapped', nested: folder + '/nested', fork: folder + '/fork'};
  assert.equal(result.results.length, 7);
  for (const item of result.results) {
    assert.equal(item.cwd, expected[item.tag]); assert.equal(item.headerCwd, record.localRoot);
    await readProof(item.cwd, item.tag);
  }
  const {teamMode} = await fixture({action: 'prepare'});
  const runTeam = async (tag, cwd) => {
    await rpc('session/prompt', {request: {sessionId, requestId: randomUUID(), mode: 'queue', content: [{type: 'text', text: 'SSH_TEAM_LEAD::' + tag}]}});
    const status = await fixture({action: 'status', tag});
    assert.equal(status.teamTask, teamMode);
    for (const provider of ['spawn', 'fork']) await readProof(cwd, 'team-' + tag + '-' + provider);
    return status;
  };
  assert.equal((await runTeam('first', folder + '/sub')).cwd, folder + '/sub');
  const api = async input => {
    const response = await auth.api(input); assert.equal(response.status, 200, JSON.stringify(response.data)); return response.data;
  };
  const before = await api({action: 'workspace-config', workspaceId: record.workspaceId});
  const {jobId} = await api({action: 'update-workspace', workspaceId: record.workspaceId, revision: before.revision, title: '通用', alias, path: folder + '/retarget'});
  const deadline = Date.now() + 15000;
  for (;;) {
    const job = await api({action: 'poll', jobId});
    if (job.done) { assert.ok(!job.error, JSON.stringify(job.error)); break; }
    assert.ok(Date.now() < deadline, 'Timed out changing the SSH workspace target');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.deepEqual(JSON.parse(await readFile(mountsFile, 'utf8'))[0].cwdResetSessions, [sessionId]);
  const after = await runTeam('second', folder + '/retarget');
  assert.equal(after.cwd, record.localRoot);
  if (/^0\.2\.[3-9]/.test(runtimeVersion())) assert.equal(after.reset, true);
  assert.deepEqual(JSON.parse(await readFile(mountsFile, 'utf8'))[0].cwdResetSessions, []);

  for (const name of await readdir(localRoot)) if (!localEntries.has(name)) assert.ok(!knownFiles.includes(name.replace(/\.txt$/, '')), 'SSH test output appeared locally');
  const archive = await rpc('workspace/archiveSession', {request: {sessionId}});
  assert.ok(archive.archivedSessionIds.includes(sessionId));
  sessionId = undefined;
  await writeFile(join(artifacts, 'subagent-result-' + runtimeVersion() + '.json'), JSON.stringify({host: runtimeVersion(), sshFixture: !!sshFixture, teamMode, retargetedCwd: true, nativeSpawnAndFork: true, remoteNativeReadWrite: true, remoteSearch: true, nestedChild: true, localPathBlocked: true, archived: true}, null, 2));
  console.log('PASS: DSH ' + runtimeVersion() + ' native spawn/fork' + (teamMode ? ' with Team mode' : '') + ', SSH cwd retargeting, concurrent nested children, remote read/write and search, local-path rejection, archived validation session.');
} catch (error) { if (host) console.error(host.log); console.error('Diagnostics: ' + home); throw error; }
finally {
  if (sessionId) await rpc('workspace/archiveSession', {request: {sessionId, stopActivity: true}}).catch(error => console.error('Validation session archive failed:', error.message));
  await host?.stop();
  if (connection && folder) {
    const files = dirs.flatMap(dir => knownFiles.map(tag => quote(folder + dir + '/' + tag + '.txt')));
    await exec(connection, 'rm -f -- ' + files.join(' ') + '; rmdir -- ' + dirs.toReversed().map(dir => quote(folder + dir)).join(' ')).catch(() => {});
  }
  mounts?.dispose();
  await sshFixture?.close();
}

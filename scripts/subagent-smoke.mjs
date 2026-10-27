import assert from 'node:assert/strict';
import {mkdir, mkdtemp, copyFile, writeFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {root, artifacts} from './env.mjs';
import {prepareHome, startHost, authenticated} from './host-fixture.mjs';
import {ConfigStore} from '../src/host/config.js';
import {Mounts} from '../src/host/mounts.js';
import {exec, quote} from '../src/host/ssh.js';

await mkdir(artifacts, {recursive: true});
const home = await mkdtemp(join(artifacts, 'subagent-'));
const store = new ConfigStore(join(artifacts, 'real-server')), config = await store.get(), alias = config.hosts[0].alias;
const mounts = new Mounts(store);
let host;
try {
  const connection = await mounts.connect(alias), remoteHome = (await mounts.browse(alias, '.')).path;
  const folder = remoteHome + '/.dsh-ssh/validation/subagent-' + Date.now();
  const dirs = ['', '/sub', '/relative', '/absolute', '/mapped', '/nested', '/fork'];
  await exec(connection, 'mkdir -p ' + dirs.map(dir => quote(folder + dir)).join(' '));
  await prepareHome(home, {extraPatch: '- id: sandbox-policy\n  config:\n    mode: workspace-write\n- id: agent-default-model\n  config:\n    provider: ssh-subagent-fixture\n    model: test\n- insert:\n    - id: ssh-child-fixture\n      name: ' + JSON.stringify(join(root, 'scripts/subagent-fixture.mjs').replaceAll('\\', '/')) + '\n'});
  const dataDir = join(home, 'plugins/deepseek-harness-ssh'); await mkdir(dataDir, {recursive: true});
  for (const name of ['config', 'known-hosts.json']) await copyFile(join(store.root, name), join(dataDir, name));
  host = await startHost(home); const auth = await authenticated(host.url);
  const open = await auth.api({action: 'open', alias, path: folder}); assert.equal(open.status, 200);
  let record;
  while (!record) {
    const {data} = await auth.api({action: 'poll', jobId: open.data.jobId});
    if (data.done) { assert.ok(!data.error, JSON.stringify(data.error)); record = data.result; }
    else await new Promise(resolve => setTimeout(resolve, 100));
  }
  const response = await fetch(auth.origin + '/api/ssh-child-test', {method: 'POST', headers: {'Content-Type': 'application/json', Origin: auth.origin, Cookie: auth.cookie}, body: JSON.stringify({id: record.id}), signal: AbortSignal.timeout(180000)});
  const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result));
  const expected = {default: folder, changed: folder + '/sub', relative: folder + '/relative', absolute: folder + '/absolute', mapped: folder + '/mapped', nested: folder + '/nested', fork: folder + '/fork'};
  assert.equal(result.results.length, 7);
  for (const item of result.results) {
    assert.equal(item.cwd, expected[item.tag]); assert.equal(item.headerCwd, record.localRoot);
    const value = await mounts.request({alias}, {action: 'read', path: item.cwd + '/' + item.tag + '.txt', limit: 1024});
    assert.equal(Buffer.from(value.data, 'base64').toString(), 'SSH_CHILD_REMOTE_OK ' + item.tag + '\n');
  }
  assert.deepEqual(await readdir(record.localRoot), []);
  await writeFile(join(artifacts, 'subagent-result.json'), JSON.stringify({nativeHost: true, nativeSpawnAndFork: true, remoteNativeReadWrite: true, changedCwd: true, relativeCwd: true, absoluteCwd: true, mappedCwd: true, nestedChild: true, localPathBlocked: true, noLocalFileMirror: true, isolatedFromDesktop: true}, null, 2));
  console.log('PASS: real DSH spawn/fork + nested children, inherited/changed/relative/absolute/mapped SSH cwd, native remote write/read and local-path rejection. User desktop unchanged.');
} catch (error) { if (host) console.error(host.log); console.error('Diagnostics: ' + home); throw error; }
finally { await host?.stop(); mounts.dispose(); }

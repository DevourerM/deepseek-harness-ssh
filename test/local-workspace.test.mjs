import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Mounts} from '../src/host/mounts.js';
import {RemoteFileSystem, installFileSystem} from '../src/host/filesystem.js';
import {ConfigStore} from '../src/host/config.js';
import {sshFixture} from './ssh-fixture.mjs';
import {fingerprintOf} from '../src/host/ssh.js';

test('SSH routing isolates local paths, concurrent sessions, and changed POSIX directories', async () => {
  const mounts = new Mounts({});
  const a = {id:'a', localRoot:join(tmpdir(),'ssh-route-a'), remoteRoot:'/srv/a'};
  const b = {id:'b', localRoot:join(tmpdir(),'ssh-route-b'), remoteRoot:'/srv/b'}; mounts.records = [a,b];
  assert.equal(mounts.route('outside.txt', tmpdir()), null);
  assert.equal(mounts.route('a.txt', a.localRoot).path, '/srv/a/a.txt');
  await Promise.all([a,b].map(record => mounts.scope.run(record, async () => {
    await new Promise(r=>setTimeout(r,1));
    assert.equal(mounts.route('x').record, record);
    assert.equal(mounts.route('x','/srv/subdir').path, '/srv/subdir/x');
    assert.equal(mounts.route('C:\\srv\\' + record.id + '\\file.txt').path, record.remoteRoot + '/file.txt');
  })));
  assert.equal(mounts.route('x'), null);
  assert.throws(()=>mounts.scope.run(a,()=>mounts.route('C:\\outside\\file.txt')),{code:'FS_SANDBOX_DENIED'});
  assert.throws(()=>mounts.scope.run(a,()=>mounts.route(join(b.localRoot,'file.txt'),a.localRoot)),{code:'FS_SANDBOX_DENIED'});
  assert.throws(()=>mounts.scope.run(a,()=>mounts.route('file.txt',b.localRoot)),{code:'FS_SANDBOX_DENIED'});
});
test('restored SSH workspaces repair generated identity titles and preserve custom names',async()=>{
  const root=await mkdtemp(join(tmpdir(),'ssh-title-')), record={id:'0123456789abcdef01234567',alias:'server',remoteRoot:'/srv/project',localRoot:join(root,'identity'),workspaceId:'workspace'};
  await writeFile(join(root,'mounts.json'),JSON.stringify([record]));
  const workspace={id:'workspace',title:record.id,async setTitle(value){this.title=value;}};
  const mounts=new Mounts({root},{workspaceRegistry:{get:()=>workspace}});
  await mounts.init();assert.equal(workspace.title,'SSH · server · project');
  workspace.title='My project';await mounts.init();assert.equal(workspace.title,'My project');
  record.title='Custom Saved Title';await writeFile(join(root,'mounts.json'),JSON.stringify([record]));workspace.title=record.id;await mounts.init();assert.equal(workspace.title,'Custom Saved Title');
  mounts.dispose();
});
test('filesystem adapter leaves local calls alone and restores services on unload', async () => {
  const mounts = new Mounts({}); const record = {id:'one',localRoot:join(tmpdir(),'ssh-adapter'),remoteRoot:'/srv/one'}; mounts.records=[record];
  mounts.request = async (_r,q) => ({path:q.path});
  const remote = new RemoteFileSystem(mounts); const fs = {};
  for(const name of ['resolve','lstat','stat','readText','streamText','readBytes','readByteRange','listDir','writeText','editText','watch','processPath','fileUrl','contains']) fs[name] = () => 'local';
  const original=fs.resolve, undo=installFileSystem({fs},mounts,remote);
  assert.equal(fs.resolve('outside', {cwd:tmpdir()}), 'local');
  assert.equal(fs.resolve(record.localRoot), 'local', 'session headers keep the native workspace identity');
  const scopedRoot = await mounts.scope.run(record, () => fs.resolve(record.localRoot));
  assert.equal(fs.processPath(scopedRoot), record.remoteRoot);
  const target=await fs.resolve('中文 #.txt',{cwd:record.localRoot});
  assert.equal(fs.processPath(target),'/srv/one/中文 #.txt');
  assert.equal(fs.fileUrl(target),'file:///srv/one/%E4%B8%AD%E6%96%87%20%23.txt');
  assert.equal(fs.contains(remote.target(record,'/srv/one'),target),true);
  assert.equal(fs.contains(remote.target(record,'/srv/one'),remote.target(record,'/srv/other')),false);
  await assert.rejects(()=>remote.writeText(target,'x',null,null,{mode:'read-only'}),{code:'FS_SANDBOX_DENIED'});
  undo(); assert.equal(fs.resolve,original);
});
test('password workspace reconnection pauses operations, accepts manual retry, and stores no password', async () => {
  const root=await mkdtemp(join(tmpdir(),'ssh-password-mount-')), server=await sshFixture(root);
  const store=new ConfigStore(join(root,'config')); await store.init(); const initial=await store.get();
  await store.save(`Host password-test\n HostName 127.0.0.1\n User tester\n Port ${server.port}\n IdentityAgent none\n`,initial.revision);
  const ssh2 = (await import('ssh2')).default; const parsed=ssh2.utils.parseKey(server.key);
  await store.pin(`[127.0.0.1]:${server.port}`,fingerprintOf(parsed.getPublicSSH()));
  const mounts=new Mounts(store);
  try {
    const pending=mounts.ensure('password-test');
    for(let i=0;!mounts.authState().length&&i<100;i++)await new Promise(r=>setTimeout(r,10));
    assert.equal(mounts.authState()[0].error.code,'SSH_AUTH_REQUIRED');
    await assert.rejects(()=>mounts.connect('password-test',{'password-test':{password:'wrong-secret'}}),{code:'SSH_AUTH_FAILED'});
    const c=await mounts.connect('password-test',{'password-test':{password:'test-password'}});
    assert.equal(await pending,c);assert.deepEqual(mounts.authState(),[]);
    const createdWorkspaces=[];
    mounts.ctx={workspaceRegistry:{create:async(path,title)=>{const w={id:'ws-'+createdWorkspaces.length,path,title,async setTitle(v){this.title=v;}};createdWorkspaces.push(w);return w;}}};
    const opened=await mounts.open('password-test','.',{},undefined,'My Named SSH Workspace');
    assert.equal(opened.title,'My Named SSH Workspace');
    assert.equal(createdWorkspaces[0].title,'My Named SSH Workspace');
    assert.ok(!(await readFile(join(store.root,'config'),'utf8')).includes('test-password'));
    mounts.disconnect('password-test');
    const cancelled=mounts.ensure('password-test');
    for(let i=0;!mounts.authState().length&&i<100;i++)await new Promise(r=>setTimeout(r,10));
    const rejection=assert.rejects(cancelled,{code:'CANCELLED'});mounts.cancelAuth(mounts.authState()[0].id);await rejection;
  } finally {mounts.dispose();await server.close();}
});

test('unscoped POSIX paths (such as /api/file chat images) resolve via matching remoteRoot, specificity, active ties, and connected fallback without breaking local files', async () => {
  class FakeFsError extends Error { constructor(message, code) { super(message); this.code = code; } }
  const root = await mkdtemp(join(tmpdir(), 'ssh-unscoped-'));
  const a = {id: 'a', alias: 'host-a', localRoot: join(root, 'a'), remoteRoot: '/srv/shared'};
  const b = {id: 'b', alias: 'host-b', localRoot: join(root, 'b'), remoteRoot: '/srv/shared'};
  const sub = {id: 'sub', alias: 'host-sub', localRoot: join(root, 'sub'), remoteRoot: '/srv/shared/sub'};
  const mounts = new Mounts({}, {sessions: {list: () => [{header: {cwd: b.localRoot}}]}});
  mounts.records = [a, b, sub];
  mounts.connections.set('host-a', {});
  mounts.connections.set('host-b', {});

  const remoteFiles = new Map([
    ['host-a:/srv/shared/only-a.png', Buffer.from('png-a')],
    ['host-b:/srv/shared/转角结构投影后的带边对比.png', Buffer.from('png-b')],
    ['host-sub:/srv/shared/sub/nested.png', Buffer.from('png-sub')],
    ['host-b:/tmp/outside.png', Buffer.from('png-tmp')]
  ]);
  const calls = [];
  mounts.request = async (record, q) => {
    calls.push(`${record.alias}:${q.action}:${q.path}`);
    if (q.action === 'resolve') return {path: q.path};
    const buf = remoteFiles.get(`${record.alias}:${q.path}`);
    if (q.action === 'stat') return buf ? {type: 'file', size: buf.length, version: '1'} : undefined;
    if (q.action === 'read') { if (!buf) throw Object.assign(new Error('not found'), {code: 'FS_NOT_FOUND'}); return {data: buf.toString('base64')}; }
    return undefined;
  };
  const remote = new RemoteFileSystem(mounts, FakeFsError);
  const fs = {
    resolve: (path) => ({targetKey: 'local:' + path, displayPath: path}),
    stat: async () => undefined,
    lstat: async () => undefined,
    readText: async () => 'local',
    streamText: async () => 'local',
    readBytes: async () => Buffer.from('local'),
    readByteRange: async () => Buffer.from('local'),
    listDir: async () => [],
    writeText: async () => {},
    editText: async () => {},
    watch: async () => async () => {},
    processPath: (t) => t.displayPath,
    fileUrl: (t) => 'file://' + t.displayPath,
    contains: () => false
  };
  const undo = installFileSystem({fs}, mounts, remote);
  try {
    // 1. Most specific remoteRoot wins (/srv/shared/sub beats /srv/shared) even if host-sub is disconnected.
    const subTarget = await fs.resolve('/srv/shared/sub/nested.png');
    assert.equal(subTarget.ssh.record.id, 'sub');
    assert.equal(fs.processPath(subTarget), '/srv/shared/sub/nested.png');

    // 2. Tied remoteRoot prefers live session mount (host-b) with Chinese filename.
    const bTarget = await fs.resolve('/srv/shared/转角结构投影后的带边对比.png');
    assert.equal(bTarget.ssh.record.id, 'b');
    assert.equal((await fs.readBytes(bTarget)).toString(), 'png-b');

    // 3. Tied remoteRoot falls back to other connected mount if absent on primary.
    const aTarget = await fs.resolve('/srv/shared/only-a.png');
    assert.equal(aTarget.ssh.record.id, 'a');

    // 4. Outside remoteRoot (/tmp/outside.png) falls back to active connected SSH mount when absent locally.
    const tmpTarget = await fs.resolve('/tmp/outside.png');
    assert.equal(tmpTarget.ssh.record.id, 'b');
    assert.equal((await fs.readBytes(tmpTarget)).toString(), 'png-tmp');

    // 5. Missing file returns local target (so /api/file serves 404) without connecting disconnected host-sub.
    const missing = await fs.resolve('/tmp/does-not-exist.png');
    assert.equal(missing.ssh, undefined);
    assert.ok(!calls.some(c => c.startsWith('host-sub:') && c.includes('/tmp/')));

    // 6. Scoped FS_SANDBOX_DENIED surfaces as FsError instance (not plain SshError).
    await assert.rejects(() => Promise.resolve().then(() => mounts.scope.run(a, () => fs.resolve('C:\\outside\\secret.png'))), err => err instanceof FakeFsError && err.code === 'FS_SANDBOX_DENIED');
  } finally { undo(); mounts.dispose(); }
});

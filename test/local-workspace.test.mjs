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
  })));
  assert.equal(mounts.route('x'), null);
  assert.throws(()=>mounts.scope.run(a,()=>mounts.route('C:\\outside\\file.txt')),{code:'FS_SANDBOX_DENIED'});
});
test('restored SSH workspaces repair generated identity titles and preserve custom names',async()=>{
  const root=await mkdtemp(join(tmpdir(),'ssh-title-')), record={id:'0123456789abcdef01234567',alias:'server',remoteRoot:'/srv/project',localRoot:join(root,'identity'),workspaceId:'workspace'};
  await writeFile(join(root,'mounts.json'),JSON.stringify([record]));
  const workspace={title:record.id,async setTitle(value){this.title=value;}};
  const mounts=new Mounts({root},{workspaceRegistry:{get:()=>workspace}});
  await mounts.init();assert.equal(workspace.title,'SSH · server · project');
  workspace.title='My project';await mounts.init();assert.equal(workspace.title,'My project');mounts.dispose();
});
test('filesystem adapter leaves local calls alone and restores services on unload', async () => {
  const mounts = new Mounts({}); const record = {id:'one',localRoot:join(tmpdir(),'ssh-adapter'),remoteRoot:'/srv/one'}; mounts.records=[record];
  mounts.request = async (_r,q) => ({path:q.path});
  const remote = new RemoteFileSystem(mounts); const fs = {};
  for(const name of ['resolve','lstat','stat','readText','streamText','readBytes','readByteRange','listDir','writeText','editText','watch','processPath','fileUrl','contains']) fs[name] = () => 'local';
  const original=fs.resolve, undo=installFileSystem({fs},mounts,remote);
  assert.equal(fs.resolve('outside', {cwd:tmpdir()}), 'local');
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
    assert.ok(!(await readFile(join(store.root,'config'),'utf8')).includes('test-password'));
    mounts.disconnect('password-test');
    const cancelled=mounts.ensure('password-test');
    for(let i=0;!mounts.authState().length&&i<100;i++)await new Promise(r=>setTimeout(r,10));
    const rejection=assert.rejects(cancelled,{code:'CANCELLED'});mounts.cancelAuth(mounts.authState()[0].id);await rejection;
  } finally {mounts.dispose();await server.close();}
});

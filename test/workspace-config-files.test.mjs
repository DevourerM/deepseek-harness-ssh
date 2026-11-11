import test from 'node:test';
import assert from 'node:assert/strict';
import {RemoteFileSystem} from '../src/host/filesystem.js';
import {Mounts} from '../src/host/mounts.js';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('retarget invalidates old file handles before writes and keeps title-only handles usable',async()=>{
 const mounts=new Mounts({}), record={id:'identity',alias:'old',remoteRoot:'/old',localRoot:join(tmpdir(),'ssh-stale-handle')};mounts.records=[record];let calls=0;
 mounts.request=async(_record,query)=>{calls++;return query.action==='read'?{data:Buffer.from('content').toString('base64')}:{path:query.path};};
 const remote=new RemoteFileSystem(mounts), target=remote.target(record,'/old/file.txt');
 record.title='Renamed';assert.equal(await remote.readText(target),'content');assert.equal(calls,1);
 record.alias='next';record.remoteRoot='/next';
 await assert.rejects(()=>remote.writeText(target,'new',null,null,{mode:'danger-full-access'}),{code:'FS_STALE_VERSION'});
 await assert.rejects(()=>remote.readText(target),{code:'FS_STALE_VERSION'});
 assert.throws(()=>remote.processPath(target),{code:'FS_STALE_VERSION'});assert.equal(calls,1);
 const fresh=remote.target(record,'/next/file.txt');assert.notEqual(fresh.targetKey,target.targetKey);assert.equal(await remote.readText(fresh),'content');
 mounts.dispose();
});
test('a mapping change while resolving a file rejects the in-flight old result',async()=>{
 const mounts=new Mounts({}),record={id:'identity',alias:'old',remoteRoot:'/old'},entered=Promise.withResolvers(),release=Promise.withResolvers();
 mounts.request=async(_record,query)=>{entered.resolve();await release.promise;return {path:query.path};};
 const remote=new RemoteFileSystem(mounts),pending=remote.resolve({record,path:'/old/file.txt'}),rejected=assert.rejects(pending,{code:'FS_STALE_VERSION'});
 await entered.promise;record.remoteRoot='/new';release.resolve();await rejected;mounts.dispose();
});

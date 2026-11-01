import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {createServer} from 'node:http';
import WebSocket from 'ws';
import {SidebarAdapter,installSidebarAdapter} from '../src/host/sidebar.js';

class Response extends EventEmitter {
  headersSent=false;
  writeHead(status,headers){this.status=status;this.headers=headers;this.headersSent=true;}
  end(value){this.value=value;this.writableEnded=true;}
}
test('existing Files API preserves the original local request body and admission identity',async()=>{
  const ctx={sessions:{get:()=>({header:{cwd:'local'}})},connection:{requestRejection:()=>undefined}};
  const adapter=new SidebarAdapter(ctx,{byPath:()=>null});
  const req=Readable.from([Buffer.from('{"sessionId":"local","path":"local.txt"}')]);req.url='/sidebar/api/fs.read';req.method='POST';
  const res=new Response();let called=0;
  await adapter.handle(req,res,async original=>{called++;assert.equal(original,req);let raw='';for await(const part of original)raw+=part;assert.equal(JSON.parse(raw).path,'local.txt');res.end('local');});
  assert.equal(called,1);assert.equal(res.value,'local');
});
test('file compatibility routes authenticate before consuming bodies or contacting SSH',async()=>{
  const adapter=new SidebarAdapter({connection:{requestRejection:()=>403}},{request:()=>assert.fail('must not contact SSH')});
  const req={url:'/sidebar/api/fs.tree',method:'POST',[Symbol.asyncIterator](){assert.fail('must not consume rejected request');}};
  const res=new Response();await adapter.handle(req,res,()=>assert.fail('must not call original'));assert.equal(res.status,403);
});
test('file backend derives host, root, cwd and permission from the session rather than client hints',async()=>{
  const record={id:'r',remoteRoot:'/srv/project',localRoot:'identity'};let query;
  const mounts={scope:{run:(_r,fn)=>fn()},byPath:()=>record,route:(path,cwd)=>({record,path:path||cwd}),request:async(_record,q)=>{query=q;return {};}};
  const ctx={workingDirectory:{get:()=>'/srv/project/sub'},sandboxPolicy:{resolve:()=>({mode:'read-only'})}};
  await new SidebarAdapter(ctx,mounts).request({record,session:{id:'s'}},'fs.read',{path:'/srv/project/a',root:'/',cwd:'/etc',mode:'danger-full-access'});
  assert.equal(query.root,'/srv/project');assert.equal(query.cwd,'/srv/project/sub');assert.equal(query.mode,'read-only');assert.equal(query.path,'/srv/project/a');
});
test('file compatibility restores route and websocket hooks when the plugin unloads',()=>{
  const originalWatch={path:'/sidebar/ws/fs-watch',handler(){}};
  const server={match:()=>undefined,registerUpgrade(){},upgrades:new Map([[originalWatch.path,originalWatch]])},match=server.match,register=server.registerUpgrade,cleanup=[];
  const ctx={inject:(_keys,fn)=>fn({...ctx,webServer:server,effect:fn=>cleanup.push(fn())})};
  installSidebarAdapter(ctx,{});assert.notEqual(server.match,match);assert.notEqual(server.upgrades.get(originalWatch.path),originalWatch);
  cleanup.reverse().forEach(fn=>fn());assert.equal(server.match,match);assert.equal(server.registerUpgrade,register);assert.equal(server.upgrades.get(originalWatch.path),originalWatch);
});

test('collapsed directories cancel pending SSH watches and duplicate watches do not reopen channels',async t=>{
  const record={id:'r',remoteRoot:'/srv/project',localRoot:'identity'}, requests=[],cleanup=[];
  const original={path:'/sidebar/ws/fs-watch',handler(){assert.fail('remote watch must use SSH adapter');}};
  const webServer={match:()=>undefined,registerUpgrade(){},upgrades:new Map([[original.path,original]])};
  const ctx={sessions:{get:()=>({id:'s',header:{cwd:'identity'}})},connection:{requestRejection:()=>undefined},workingDirectory:{get:()=>'/srv/project'},sandboxPolicy:{resolve:()=>({mode:'read-only'})},
    inject:(_keys,fn)=>fn({...ctx,webServer,effect:fn=>cleanup.push(fn())})};
  const mounts={scope:{run:(_record,fn)=>fn()},byPath:()=>record,route:path=>({record,path}),request:(_record,query,signal)=>{const deferred=Promise.withResolvers();requests.push({...deferred,signal,query});return deferred.promise;}};
  installSidebarAdapter(ctx,mounts);
  const server=createServer();server.on('upgrade',(req,socket,head)=>webServer.upgrades.get(original.path).handler(req,socket,head));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let ws;
  t.after(async()=>{ws?.terminate();cleanup.reverse().forEach(fn=>fn());await new Promise(resolve=>server.close(resolve));});
  ws=new WebSocket(`ws://127.0.0.1:${server.address().port}${original.path}?sessionId=s`);
  const frames=[];ws.on('message',raw=>frames.push(JSON.parse(raw.toString())));
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  const until=async condition=>{for(let i=0;i<100;i++){if(condition())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('watch state did not settle');};
  const send=op=>ws.send(JSON.stringify({op,path:'/srv/project/folder'}));
  send('watch');await until(()=>requests.length===1);
  send('unwatch');await until(()=>requests[0].signal.aborted);
  requests[0].resolve({versions:[{version:'old'}]});await new Promise(resolve=>setTimeout(resolve,10));assert.deepEqual(frames,[]);
  send('watch');await until(()=>requests.length===2);
  send('watch');requests[1].resolve({versions:[{version:'current'}]});await until(()=>frames.length>=1);
  send('watch');await until(()=>frames.length>=2);assert.equal(requests.length,2);
  send('unwatch');send('watch');await until(()=>requests.length===3);
  ws.close();await until(()=>requests[2].signal.aborted);requests[2].resolve({versions:[{version:'late'}]});
});

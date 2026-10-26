import {posix} from 'node:path';
import {SshError} from './config.js';
import {WebSocketServer} from 'ws';

const json = (res, status, value) => {res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));};
async function body(req, limit) {
  const chunks=[];let size=0;
  for await(const chunk of req){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>limit)throw new SshError('文件请求过大','too-large',null,413);chunks.push(bytes);}
  return Buffer.concat(chunks);
}
export class SidebarAdapter {
  constructor(ctx,mounts){this.ctx=ctx;this.mounts=mounts;}
  session(id){const session=typeof id==='string'&&this.ctx.sessions.get(id);const record=session&&this.mounts.byPath(session.header.cwd);return record?{session,record}:null;}
  async request(scope,method,input,signal){
    const {record,session}=scope;
    const current=this.ctx.workingDirectory.get(session), cwd=this.mounts.scope.run(record,()=>this.mounts.route('',current))?.path||record.remoteRoot;
    if(method==='session.cwd')return {sessionId:session.id,cwd,root:posix.basename(cwd)||'/',parent:cwd===record.remoteRoot?null:posix.dirname(cwd)};
    const path=input.path===undefined?cwd:input.path;
    if(typeof path!=='string'||path.length>4096)throw new SshError('文件路径无效','bad-request');
    const resolve=value=>this.mounts.scope.run(record,()=>this.mounts.route(value,cwd));
    const route=resolve(path);
    if(!route||route.record.id!==record.id)throw new SshError('文件不属于当前远程工作区','forbidden',null,403);
    const policy=this.ctx.sandboxPolicy.resolve({session});
    const mapped={...input};
    if(Array.isArray(input.paths))mapped.paths=input.paths.map(p=>{const r=typeof p==='string'&&resolve(p);if(!r||r.record.id!==record.id)throw new SshError('目录不属于当前远程工作区','forbidden',null,403);return r.path;});
    if(input.dir!==undefined){const r=typeof input.dir==='string'&&resolve(input.dir);if(!r||r.record.id!==record.id)throw new SshError('上传目录无效','forbidden',null,403);mapped.dir=r.path;}
    return this.mounts.request(record,{...mapped,action:'sidebar',op:method,path:route.path,root:record.remoteRoot,cwd,mode:policy.mode},signal);
  }
  async handle(req,res,original){
    const url=new URL(req.url||'/','http://dsh.internal'), pathname=url.pathname;
    const api=pathname.startsWith('/sidebar/api/'), method=api?pathname.slice(13):pathname.slice(9);
    if(!api&&!['write','upload','file','html','archive'].includes(method))return original(req,res);
    if(api&&method!=='session.cwd'&&!method.startsWith('fs.'))return original(req,res);
    const rejection=this.ctx.connection.requestRejection(req);
    if(rejection){json(res,rejection,{ok:false,error:{code:'forbidden',message:'请求未通过 DSH 认证'}});return;}
    const controller=new AbortController(), close=()=>{if(!res.writableEnded)controller.abort();};res.once('close',close);
    try{
      let input,raw;
      if(api){
        if(req.method!=='POST')throw new SshError('method not allowed','method-error',null,405);
        raw=await body(req,1024*1024);
        // Keep the original request and admission identity when a local session
        // falls through to Better Sidebar's own handler.
        req[Symbol.asyncIterator]=async function*(){yield raw;};
        try{input=JSON.parse(raw.toString('utf8')||'{}');}catch{throw new SshError('无效 JSON','bad-request');}
        if(!input||typeof input!=='object'||Array.isArray(input))throw new SshError('无效请求','bad-request');
      }else input=Object.fromEntries(url.searchParams);
      const scope=this.session(input.sessionId);if(!scope)return await original(req,res);
      if(method==='write'||method==='upload'){
        if(req.method!=='POST')throw new SshError('method not allowed','method-error',null,405);
        raw=await body(req,8*1024*1024);
        input=method==='write'?{...input,content:new TextDecoder('utf-8',{fatal:true}).decode(raw)}:{...input,data:raw.toString('base64')};
      }else if(!api&&!['GET','HEAD'].includes(req.method))throw new SshError('method not allowed','method-error',null,405);
      const value=await this.request(scope,api?method:'fs.'+method,input,controller.signal);
      if(!api&&['file','html'].includes(method)){
        const bytes=Buffer.from(value.data,'base64'), ext=posix.extname(input.path||'').toLowerCase();
        const types={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml','.pdf':'application/pdf','.txt':'text/plain; charset=utf-8'};
        const download=input.download==='1';
        res.writeHead(200,{'content-type':method==='html'?'text/html; charset=utf-8':types[ext]||'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff',...(method==='html'?{'content-security-policy':"sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'"}:{}),...(download?{'content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(posix.basename(input.path))}:{})});
        res.end(req.method==='HEAD'?undefined:bytes);
      }else json(res,200,{ok:true,value});
    }catch(error){
      const conflict=['FS_STALE_VERSION','fs-conflict'].includes(error.code), denied=['FS_SANDBOX_DENIED','forbidden'].includes(error.code);
      if(!res.headersSent)json(res,error.status||(conflict?409:denied?403:400),{ok:false,error:{code:conflict?'fs-conflict':denied?'forbidden':error.code||'fs-error',message:error.message}});
    }finally{res.off('close',close);}
  }
}
export function installSidebarAdapter(ctx,mounts){
  // Reuse the installed file UI and its wire protocol. Route selection stays
  // with the original server, and local sessions retain the original handler.
  ctx.inject(['webServer'],scope=>{
    const server=scope.webServer, descriptor=Object.getOwnPropertyDescriptor(server,'match'), original=server.match.bind(server), adapter=new SidebarAdapter(scope,mounts);
    const replacement=pathname=>{const route=original(pathname);return route&&pathname.startsWith('/sidebar/')?{...route,handler:(req,res)=>adapter.handle(req,res,route.handler)}:route;};
    server.match=replacement;
    scope.effect(()=>()=>{if(Object.getOwnPropertyDescriptor(server,'match')?.value===replacement){if(descriptor)Object.defineProperty(server,'match',descriptor);else delete server.match;}});
    const sockets=new WebSocketServer({noServer:true,maxPayload:16384});
    const wrap=route=>{
      if(route.path!=='/sidebar/ws/fs-watch')return route;
      return {...route,handler:(req,socket,head)=>{
        const url=new URL(req.url||'/','http://dsh.internal'), session=adapter.session(url.searchParams.get('sessionId'));
        if(!session)return route.handler(req,socket,head);
        if(scope.connection.requestRejection(req)!==undefined){socket.destroy();return;}
        sockets.handleUpgrade(req,socket,head,ws=>{
          const watched=new Map(), pendingPaths=new Set(), control=new AbortController();let timer,closed=false,polling=false;
          const send=value=>{if(ws.readyState===1)ws.send(JSON.stringify(value));};
          ws.on('error',()=>{});
          ws.on('message',async raw=>{
            let pending;
            try{
              const message=JSON.parse(raw.toString());if(typeof message.path!=='string'||message.path.length>4096)return;
              if(message.op==='unwatch'){watched.delete(message.path);return;}
              if(message.op!=='watch'||pendingPaths.has(message.path)||(watched.size+pendingPaths.size>=64&&!watched.has(message.path)))return;
              pending=message.path;pendingPaths.add(pending);
              const {versions}=await adapter.request(session,'fs.watch',{paths:[message.path]},control.signal);
              if(versions[0].error){send({dir:message.path,ok:false});return;}
              if(!closed){watched.set(message.path,versions[0].version);send({dir:message.path,ok:true});}
            }catch{if(!closed)send({dir:'',ok:false});}finally{if(pending)pendingPaths.delete(pending);}
          });
          const poll=async()=>{
            if(closed||polling||!watched.size)return;polling=true;
            try{
              const paths=[...watched.keys()], {versions}=await adapter.request(session,'fs.watch',{paths},control.signal);
              versions.forEach((entry,i)=>{const path=paths[i];if(!closed&&watched.has(path)&&entry.version!==watched.get(path)){watched.set(path,entry.version);send({dir:path});}});
            }catch{}finally{polling=false;}
          };
          timer=setInterval(poll,2500);timer.unref();
          ws.once('close',()=>{closed=true;control.abort();clearInterval(timer);watched.clear();});
        });
      }};
    };
    const ownUpgrade=Object.getOwnPropertyDescriptor(server,'registerUpgrade'), register=server.registerUpgrade.bind(server), replacementUpgrade=route=>register(wrap(route));
    server.registerUpgrade=replacementUpgrade;
    const existing=server.upgrades?.get('/sidebar/ws/fs-watch'), upgraded=existing&&wrap(existing);if(upgraded)server.upgrades.set(existing.path,upgraded);
    scope.effect(()=>()=>{
      for(const ws of sockets.clients)ws.terminate();sockets.close();
      if(existing&&server.upgrades.get(existing.path)===upgraded)server.upgrades.set(existing.path,existing);
      if(Object.getOwnPropertyDescriptor(server,'registerUpgrade')?.value===replacementUpgrade){if(ownUpgrade)Object.defineProperty(server,'registerUpgrade',ownUpgrade);else delete server.registerUpgrade;}
    });
  });
}

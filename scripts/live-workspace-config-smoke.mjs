import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import WebSocket from 'ws';
import {root,artifacts} from './env.mjs';
const profile=process.env.DSH_PROFILE_DIR||join(homedir(),'.dsh/profiles/desktop');
const {parseDocument}=await import(pathToFileURL(join(profile,'node_modules/yaml/dist/index.js')).href);
const url=new URL(process.env.DSH_WEB_URL||'http://127.0.0.1:19387');
const doc=parseDocument(await readFile(join(process.env.DSH_HOME||join(homedir(),'.dsh'),'.credentials.yaml'),'utf8'));
const record=doc.getIn(['records','client-connection/browser-session']).toJSON();
const now=Date.now(),body=Buffer.from(JSON.stringify({version:1,authority:url.host,issuedAt:now,expiresAt:now+3600000})).toString('base64url');
const name='dsh-auth-'+createHash('sha256').update(url.host).digest('base64url');
const value=`v1.${body}.${createHmac('sha256',Buffer.from(record.payload.secret,'base64url')).update(body).digest('base64url')}`;
const cookie=`${name}=${value}`;
const api=async input=>{const response=await fetch(new URL('/api/dsh-ssh',url),{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,Origin:url.origin},body:JSON.stringify(input)});const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;};
function workspaceSnapshot(){return new Promise((resolve,reject)=>{const streamId=randomUUID(),socket=new WebSocket(new URL('/api/remote.mux',url).href.replace(/^http:/,'ws:'),{headers:{cookie,origin:url.origin}});let settled=false;const finish=(error,data)=>{if(settled)return;settled=true;clearTimeout(timer);if(socket.readyState===WebSocket.OPEN){socket.send(JSON.stringify({type:'cancel',streamId}));socket.close();}else socket.terminate();error?reject(error):resolve(data);};const timer=setTimeout(()=>finish(Error('Workspace feed timed out')),15000);socket.on('open',()=>socket.send(JSON.stringify({type:'open',streamId,endpoint:'workspace/follow',payload:{args:{}}})));socket.on('message',bytes=>{const frame=JSON.parse(bytes.toString());if(frame.streamId!==streamId)return;if(frame.type==='item')finish(null,frame.value);else if(frame.type==='error')finish(Error(frame.error?.message));});socket.on('error',error=>finish(error));});}
const fingerprint=async()=>({workspaces:(await workspaceSnapshot()).value.items.map(item=>({workspaceId:item.workspaceId,path:item.path,title:item.title,sessionIds:item.sessionIds})),mounts:await api({action:'sessions'})});
const file=join(artifacts,'live-workspace-config-before.json');
if(process.argv.includes('--record')){await writeFile(file,JSON.stringify(await fingerprint(),null,2));console.log('Recorded existing workspace/conversation associations before plugin installation.');process.exit(0);}
const before=JSON.parse(await readFile(file,'utf8')),after=await fingerprint();assert.deepEqual(after.workspaces,before.workspaces);assert.deepEqual(after.mounts.map(({state,...item})=>item),before.mounts.map(({state,...item})=>item));
const {chromium}=await import(pathToFileURL(process.env.SSH_PLAYWRIGHT||resolve(root,'../tree-chat/artifacts/browser-tools/node_modules/playwright/index.mjs')).href);
const browser=await chromium.launch({headless:true,executablePath:process.env.SSH_CHROMIUM||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
await page.context().addCookies([{name,value,url:url.origin,httpOnly:true,sameSite:'Strict'}]);
try{
 await page.goto(url.origin,{waitUntil:'domcontentloaded'});
 const target=after.mounts[0];assert.ok(target,'An existing SSH workspace is available for read-only verification.');const workspace=after.workspaces.find(item=>item.workspaceId===target.workspaceId);assert.ok(workspace);
 const configuration=await api({action:'workspace-config',workspaceId:target.workspaceId});assert.equal(configuration.kind,'remote');assert.equal(configuration.path,target.remoteRoot);
 await page.getByText(workspace.title,{exact:true}).first().click({button:'right'});await page.getByRole('menuitem',{name:'工作区配置',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'工作区配置',exact:true});await dialog.getByLabel('远程目录',{exact:true}).waitFor();
 assert.equal(await dialog.getByLabel('远程目录',{exact:true}).inputValue(),target.remoteRoot);assert.equal(await dialog.getByLabel('工作区名称',{exact:true}).inputValue(),workspace.title);assert.equal(await dialog.getByRole('combobox',{name:'SSH 主机',exact:true}).inputValue(),target.alias);assert.equal(await dialog.getByRole('button',{name:'保存配置',exact:true}).isDisabled(),true);
 await dialog.screenshot({path:join(artifacts,'live-workspace-config.png')});await dialog.getByRole('button',{name:'关闭工作区配置',exact:true}).click();await dialog.waitFor({state:'hidden'});
 const local=after.workspaces.find(item=>!after.mounts.some(mount=>mount.workspaceId===item.workspaceId));assert.ok(local);
 await page.getByText(local.title,{exact:true}).first().click({button:'right'});await page.getByRole('menuitem',{name:'工作区配置',exact:true}).click();await dialog.getByLabel('本地目录',{exact:true}).waitFor();assert.equal(await dialog.getByLabel('本地目录',{exact:true}).getAttribute('readonly'),'');await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 assert.deepEqual((await fingerprint()).workspaces,before.workspaces);assert.deepEqual(errors,[]);
 const installed=JSON.parse(await readFile(join(profile,'node_modules/deepseek-harness-ssh/package.json'),'utf8'));assert.equal(installed.version,'0.5.0');
 await writeFile(join(artifacts,'live-workspace-config-result.json'),JSON.stringify({url:url.origin,installedVersion:installed.version,remoteConfigurationDialog:true,localConfigurationDialog:true,existingWorkspaceAssociationsPreserved:true,existingMountMappingsPreserved:true,pageErrors:errors},null,2));console.log('PASS: installed 0.5.0 at existing GUI URL, real remote/local workspace configuration menus, existing workspace and conversation associations preserved.');
}catch(error){await page.screenshot({path:join(artifacts,'live-workspace-config-failure.png'),fullPage:true}).catch(()=>{});await writeFile(join(artifacts,'live-workspace-config-failure.txt'),await page.locator('body').innerText().catch(()=>''));throw error;}finally{await browser.close();}

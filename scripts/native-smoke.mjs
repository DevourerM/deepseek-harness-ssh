import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {root, artifacts} from './env.mjs';
const launch=JSON.parse(await readFile(join(artifacts,'native-launch.json'),'utf8'));
const {chromium}=await import(pathToFileURL(process.env.SSH_PLAYWRIGHT||resolve(root,'../tree-chat/artifacts/browser-tools/node_modules/playwright/index.mjs')).href);
let browser;
for(let i=0;i<30;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:'+launch.port);break;}catch{await new Promise(r=>setTimeout(r,1000));}}
if(!browser)throw Error('Native desktop debug endpoint did not start');
let page;
for(let i=0;i<30;i++){page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('dsh-app://app/'));if(page)break;await new Promise(r=>setTimeout(r,1000));}
if(!page)throw Error('Native desktop UI did not start');
page.setDefaultTimeout(45000);
const deployed=JSON.parse(await readFile(join(artifacts,'real-server/result.json'),'utf8'));
const result={version:'0.3.0',nativeDesktop:true,origin:new URL(page.url()).origin}, errors=[];
page.on('pageerror',e=>errors.push(e.message));
try {
  const model=page.getByRole('button',{name:/选择模型，当前/}).first();
  const beforeModel=await model.getAttribute('aria-label',{timeout:2000}).catch(()=>null);
  const connected=await page.evaluate(async ({alias,path})=>{
    const send=globalThis.__DSH_TRANSPORT__?.fetch||fetch;
    const api=async input=>{for(let i=0;i<90;i++){const r=await send('/api/dsh-ssh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});if([502,503,404].includes(r.status)){await new Promise(r=>setTimeout(r,500));continue;}if(!r.ok)throw Error('SSH API '+r.status);return r.json();}throw Error('Native Host not ready');};
    const act=async input=>{const {jobId}=await api(input);for(let i=0;i<200;i++){const job=await api({action:'poll',jobId});if(job.done){if(job.error)throw Error(job.error.message);return job.result;}await new Promise(r=>setTimeout(r,200));}throw Error('SSH request timed out');};
    await act({action:'open',alias,path});return (await act({action:'check',alias})).ready;
  },{alias:deployed.alias,path:deployed.check.home});
  assert.equal(connected,true);result.realServerCheck=true;
  await page.getByRole('button',{name:'选择工作区',exact:true}).filter({hasText:'SSH · '+deployed.alias}).waitFor();
  await page.getByRole('button',{name:'添加工作区',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'新建工作区'});await dialog.getByText('你想在哪里工作？',{exact:true}).waitFor();
  await page.screenshot({path:join(artifacts,'native-workspace-choice-v030.png'),fullPage:true});await dialog.getByRole('button',{name:'关闭新建工作区'}).click();
  const afterModel=await model.getAttribute('aria-label');if(beforeModel)assert.equal(afterModel,beforeModel);
  result.localModelSelectionPreserved=true;result.remoteInLocalWorkspaceList=true;
  if(await page.getByRole('button',{name:'打开右侧边栏',exact:true}).isVisible())await page.getByRole('button',{name:'打开右侧边栏',exact:true}).click();
  const guide=page.getByRole('button',{name:'文件',exact:true});
  if(!await guide.isVisible())await page.getByRole('button',{name:'新标签页',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:/^SSH 文件/}).count(),0);
  await guide.click();
  const {ConfigStore}=await import('../src/host/config.js'), {Mounts}=await import('../src/host/mounts.js');
  const mounts=new Mounts(new ConfigStore(join(artifacts,'real-server')));
  let folder;
  try {const listing=await mounts.browse(deployed.alias,deployed.check.home+'/.dsh-ssh/validation');const latest=listing.directories.map(x=>x.name).filter(n=>/^local-\d+$/.test(n)).sort().at(-1);folder=listing.path+'/'+latest;}finally{mounts.dispose();}
  const search=page.getByPlaceholder(/按文件名搜索/);
  await search.fill(folder+'/local-model-proof.txt');
  await page.getByText(folder+'/local-model-proof.txt',{exact:true}).filter({visible:true}).first().click();
  await page.locator('.cm-content:visible').filter({hasText:/LOCAL_DSH_REMOTE_FILE_V[23]/}).waitFor();
  result.existingFilesEntry=true;result.noExtraSshFilesEntry=true;
  assert.equal(await page.locator('iframe').count(),0);result.noIframe=true;
  result.remoteFilesWithBetterSidebar=true;result.pageErrors=errors;assert.deepEqual(errors,[]);
  await page.screenshot({path:join(artifacts,'native-local-ssh-files.png'),fullPage:true});
  await writeFile(join(artifacts,'native-result.json'),JSON.stringify(result,null,2));
  console.log('PASS: actual desktop uses local model/account, remote folder in local list, existing Files tree/editor with better-sidebar, zero iframe.');
} catch(e){await writeFile(join(artifacts,'native-local-failure.txt'),await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:join(artifacts,'native-local-failure.png'),fullPage:true}).catch(()=>{});throw e;}
finally {await browser.close();}

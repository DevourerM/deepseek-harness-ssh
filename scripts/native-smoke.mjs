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
const result={version:'0.2.0',nativeDesktop:true,origin:new URL(page.url()).origin}, errors=[];
page.on('pageerror',e=>errors.push(e.message));
try {
  const model=page.getByRole('button',{name:/选择模型，当前/}).first();
  const beforeModel=await model.getAttribute('aria-label',{timeout:2000}).catch(()=>null);
  const settings=page.locator('.ds-ssh-settings');
  if(!await settings.isVisible()){await page.getByRole('button',{name:'账号菜单',exact:true}).click();await page.getByText('设置',{exact:true}).click();await page.getByText('SSH 远程工作区',{exact:true}).first().click();}
  await settings.waitFor();
  assert.ok((await settings.innerText()).includes('把远程文件夹加入本地工作区列表'));
  await settings.getByRole('button',{name:'检查连接',exact:true}).click();
  await settings.getByText('连接检查通过，可创建远程工作区',{exact:true}).waitFor({timeout:60000});
  result.realServerCheck=true;
  await page.screenshot({path:join(artifacts,'native-local-ssh-settings.png'),fullPage:true});
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'添加工作区',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'新建工作区'});await dialog.getByRole('button',{name:/远程文件夹/}).click();
  await dialog.getByLabel('远程目录',{exact:true}).fill(deployed.check.home);
  await dialog.getByRole('button',{name:'连接并创建远程工作区'}).click();await dialog.waitFor({state:'hidden',timeout:60000});
  await page.getByRole('button',{name:'选择工作区',exact:true}).filter({hasText:'SSH · '+deployed.alias}).waitFor();
  const afterModel=await model.getAttribute('aria-label');if(beforeModel)assert.equal(afterModel,beforeModel);
  result.localModelSelectionPreserved=true;result.remoteInLocalWorkspaceList=true;
  if(await page.getByRole('button',{name:'打开右侧边栏',exact:true}).isVisible())await page.getByRole('button',{name:'打开右侧边栏',exact:true}).click();
  const sshGuide=page.getByRole('button',{name:/^SSH 文件/});
  if(!await sshGuide.isVisible())await page.getByRole('button',{name:'新标签页',exact:true}).click();
  await sshGuide.click();
  const explorer=page.getByRole('region',{name:'SSH 文件',exact:true});
  await explorer.getByRole('button',{name:'▸ .dsh-ssh',exact:true}).click();
  await explorer.getByRole('button',{name:'▸ validation',exact:true}).click();
  const validation=explorer.getByRole('button',{name:/^▸ local-\d+$/}).last();await validation.click();
  await explorer.getByRole('button',{name:'local-model-proof.txt',exact:true}).click();
  await explorer.getByText('LOCAL_DSH_REMOTE_FILE_V2',{exact:true}).waitFor();
  assert.equal(await page.locator('iframe').count(),0);result.noIframe=true;
  result.remoteFilesWithBetterSidebar=true;result.pageErrors=errors;assert.deepEqual(errors,[]);
  await page.screenshot({path:join(artifacts,'native-local-ssh-files.png'),fullPage:true});
  await writeFile(join(artifacts,'native-result.json'),JSON.stringify(result,null,2));
  console.log('PASS: actual desktop uses local model/account, remote folder in local list, SSH files with existing better-sidebar, zero iframe.');
} catch(e){await writeFile(join(artifacts,'native-local-failure.txt'),await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:join(artifacts,'native-local-failure.png'),fullPage:true}).catch(()=>{});throw e;}
finally {await browser.close();}

import assert from 'node:assert/strict';
import {mkdir, mkdtemp, writeFile, readFile, copyFile, readdir, symlink} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {homedir, tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {root, artifacts} from './env.mjs';
import {prepareHome, startHost, authenticated} from './host-fixture.mjs';
import {ConfigStore} from '../src/host/config.js';
import {Mounts} from '../src/host/mounts.js';
import {RemoteFileSystem} from '../src/host/filesystem.js';
import {exec, quote} from '../src/host/ssh.js';
import {RemoteProcesses} from '../src/host/processes.js';

await mkdir(artifacts, {recursive: true});
const home = await mkdtemp(join(tmpdir(), 'dsh-ssh-files-'));
const store = new ConfigStore(join(artifacts, 'real-server')); const config = await store.get(), alias = config.hosts[0].alias;
const mounts = new Mounts(store), c = await mounts.connect(alias), remoteHome = (await mounts.browse(alias, '.')).path;
const folder = remoteHome + '/.dsh-ssh/validation/local-' + Date.now();
await exec(c, 'mkdir -p ' + quote(folder));
const record = {id: 'direct-validation', alias, remoteRoot: folder, localRoot: join(home, 'identity')}; mounts.records.push(record);
const fs = new RemoteFileSystem(mounts), target = await fs.resolve(mounts.route('边界 test.txt', record.localRoot));
const policy = {mode: 'workspace-write', workspaceRoot: record.localRoot};
await assert.rejects(() => fs.writeText(target, 'forbidden', null, null, {...policy, mode: 'read-only'}), {code: 'FS_SANDBOX_DENIED'});
const first = await fs.writeText(target, 'first\n', {kind: 'createIfAbsent'}, null, policy);
assert.equal(await fs.readText(target), 'first\n');
await assert.rejects(() => fs.writeText(target, 'collision', {kind: 'createIfAbsent'}, null, policy));
await fs.editText(target, {oldString: 'first', newString: 'second'}, {version: first.version}, null, policy);
await assert.rejects(() => fs.writeText(target, 'stale', {kind: 'replaceIfVersion', version: first.version}, null, policy), {code: 'FS_STALE_VERSION'});
const outside = folder + '-outside'; await exec(c, 'mkdir -p ' + quote(outside) + '; ln -s ' + quote(outside) + ' ' + quote(folder + '/escape'));
const escape = await fs.resolve(mounts.route('escape/no.txt', record.localRoot));
await assert.rejects(() => fs.writeText(escape, 'escape', null, null, policy), {code: 'FS_SANDBOX_DENIED'});
assert.match(fs.fileUrl(target), /^file:\/\/\/fsb\//);
console.log('PASS: real remote atomic write/edit, stale guards, Unicode, read-only and symlink boundary.');
const processes = new RemoteProcesses(mounts), start = Date.now();
const stopped = await processes.execute(record, 'sleep 20', record.localRoot, null, 1000);
assert.ok(Date.now()-start < 10000); assert.notEqual(stopped.exitCode,0); processes.dispose();

await prepareHome(home, {extraPatch: '- id: workspace-controller\n  config:\n    documentsDirectory: ' + JSON.stringify(home.replaceAll('\\', '/')) + '\n- id: agent-default-model\n  config:\n    provider: ssh-local-fixture\n    model: test\n- id: sandbox-policy\n  config:\n    mode: workspace-write\n- insert:\n    - id: local-ssh-model\n      name: ' + JSON.stringify(join(root, 'scripts/local-model-fixture.mjs').replaceAll('\\', '/')) + '\n'});
const dataDir = join(home, 'plugins/deepseek-harness-ssh'); await mkdir(dataDir, {recursive: true});
for (const name of ['config', 'known-hosts.json']) await copyFile(join(store.root, name), join(dataDir, name));
const profile=join(home,'profiles/web'), better=process.env.DSH_BETTER_SIDEBAR||join(homedir(),'.dsh/profiles/desktop/node_modules/dsh-better-sidebar');
await symlink(better,join(profile,'node_modules/dsh-better-sidebar'),'junction');
const manifest=JSON.parse(await readFile(join(profile,'package.json'),'utf8'));
manifest.dependencies['dsh-better-sidebar']='file:'+better.replaceAll('\\','/');
manifest.dsh.profile.bundles.push('dsh-better-sidebar');await writeFile(join(profile,'package.json'),JSON.stringify(manifest));
const host = await startHost(home), auth = await authenticated(host.url);
async function action(input) {
  const response = await auth.api(input); assert.equal(response.status, 200, JSON.stringify(response.data));
  while (true) { const {data} = await auth.api({action: 'poll', jobId: response.data.jobId}); if (data.done) { if (data.error) throw Object.assign(Error(data.error.message), data.error); return data.result; } await new Promise(r => setTimeout(r, 200)); }
}
const {chromium} = await import(pathToFileURL(process.env.SSH_PLAYWRIGHT || resolve(root, '../tree-chat/artifacts/browser-tools/node_modules/playwright/index.mjs')).href);
const browser = await chromium.launch({headless: true, ...(process.env.SSH_CHROMIUM ? {executablePath: process.env.SSH_CHROMIUM} : {})}); const page = await browser.newPage({viewport: {width: 1440, height: 960}}), errors = [];
const watchFrames=[];page.on('websocket',socket=>{if(socket.url().includes('/sidebar/ws/fs-watch'))socket.on('framereceived',frame=>{try{watchFrames.push(JSON.parse(frame.payload));}catch{}});});
page.setDefaultTimeout(30000); page.on('pageerror', e => errors.push(e.message)); page.on('console', msg => { if (msg.type() === 'error' || msg.type() === 'warning') console.log('Browser:', msg.text()); });
try {
  // Use the real directory-flow UI, same local Host and local model throughout.
  await page.goto(host.url, {waitUntil: 'networkidle'});
  for (let i=0;i<3;i++) { try { await page.getByRole('button', {name: /^(继续|稍后配置)$/}).first().click({timeout: i ? 1500 : 5000}); } catch { break; } }
  const startup = page.getByRole('dialog').filter({hasText: '开始使用'}); if (await startup.count()) await startup.getByRole('button', {name: '关闭', exact: true}).click();
  await page.getByRole('button', {name: '添加工作区', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: '新建工作区'}); await dialog.getByRole('button', {name: /远程文件夹/}).click();
  await dialog.getByLabel('远程目录', {exact: true}).fill(folder);
  await dialog.getByRole('button', {name: '连接并创建远程工作区'}).click(); await dialog.waitFor({state: 'hidden', timeout: 60000});
  await page.getByText('SSH · ' + alias + ' · ' + folder.split('/').at(-1), {exact: true}).first().waitFor();
  await page.getByRole('button', {name: '选择工作区', exact: true}).filter({hasText: 'SSH · ' + alias}).waitFor();
  await writeFile(join(home,'before-chat.txt'),await page.locator('body').innerText());
  await writeFile(join(home,'buttons.json'),JSON.stringify(await page.getByRole('button').evaluateAll(ns=>ns.map(n=>({label:n.getAttribute('aria-label'),title:n.getAttribute('title'),text:n.textContent}))),null,2));
  await page.locator('[contenteditable=true]:visible').last().fill('验证本地模型直接读写远程文件');
  await page.locator('[contenteditable=true]:visible').last().press('Enter');
  // ssh_exec must ask for native approval in workspace-write mode.
  await page.getByText(/远程 Shell 不使用本机沙箱/).first().waitFor({timeout: 60000});
  await writeFile(join(home, 'approval.txt'), await page.locator('body').innerText());
  await page.getByRole('button', {name: /允许一次|批准一次|仅本次允许/}).first().click();
  await page.getByText('LOCAL_MODEL_REMOTE_TOOLS_OK', {exact: true}).first().waitFor({timeout: 60000});
  assert.equal(await page.locator('iframe').count(), 0);
  assert.equal(new URL(page.url()).origin, auth.origin);
  const contents = await fs.readText(fs.target(record, folder + '/local-model-proof.txt')); assert.equal(contents, 'LOCAL_DSH_REMOTE_FILE_V2\n');
  const modelInput = JSON.parse(await readFile(join(home, 'model-input.json'), 'utf8'));
  await writeFile(join(home, 'final-model-tools.json'), JSON.stringify(modelInput.messages.filter(m=>m.role==='tool'),null,2));
  const visibleTools = JSON.stringify(modelInput.tools); assert.ok(!visibleTools.includes('"name":"pwsh"')); assert.ok(visibleTools.includes('ssh_exec'));
  await page.getByRole('button', {name: '打开右侧边栏', exact: true}).click();
  await page.getByRole('button', {name: /^文件$/}).click();
  await page.getByText('local-model-proof.txt', {exact: true}).filter({visible:true}).first().click();
  const editor=page.locator('.cm-content[contenteditable=true]:visible');
  await editor.filter({hasText:'LOCAL_DSH_REMOTE_FILE_V2'}).first().waitFor();
  await editor.last().fill('LOCAL_DSH_REMOTE_FILE_V3\n');
  await page.getByRole('button',{name:'保存',exact:true}).click();
  for(let i=0;i<60;i++){if(await fs.readText(fs.target(record,folder+'/local-model-proof.txt'))==='LOCAL_DSH_REMOTE_FILE_V3\n')break;if(i===59)throw Error('Existing editor did not save remotely');await new Promise(r=>setTimeout(r,200));}
  watchFrames.length=0;
  await page.getByText('文件',{exact:true}).filter({visible:true}).first().click();
  await page.getByText('local-model-proof.txt',{exact:true}).filter({visible:true}).first().waitFor();
  for(let i=0;!watchFrames.some(f=>f.ok===true)&&i<50;i++)await new Promise(r=>setTimeout(r,100));
  assert.ok(watchFrames.some(f=>f.ok===true),'existing file tree must acknowledge remote watch');
  // A model/external writer adds a file; the existing tree must refresh itself.
  const refreshed=fs.target(record,folder+'/自动刷新 proof.txt');
  await fs.writeText(refreshed,'REMOTE_WATCH_OK\n',{kind:'createIfAbsent'},null,policy);
  await page.getByText('自动刷新 proof.txt',{exact:true}).filter({visible:true}).first().waitFor({timeout:20000});
  const sessionId=modelInput.sessionId, headers={'Content-Type':'application/json',Cookie:auth.cookie,Origin:auth.origin};
  const callFile=async(method,input={})=>{const response=await fetch(auth.origin+'/sidebar/api/'+method,{method:'POST',headers,body:JSON.stringify({sessionId,...input})});return {status:response.status,data:await response.json()};};
  assert.equal((await callFile('fs.read',{path:'/etc/passwd',root:'/',cwd:'/etc'})).status,403);
  const foreign=await fetch(auth.origin+'/sidebar/api/fs.read',{method:'POST',headers:{...headers,Origin:'https://attacker.invalid'},body:JSON.stringify({sessionId,path:folder+'/local-model-proof.txt'})});assert.equal(foreign.status,403);
  const unsigned=await fetch(auth.origin+'/sidebar/api/fs.read',{method:'POST',headers:{'Content-Type':'application/json',Origin:auth.origin},body:JSON.stringify({sessionId,path:folder+'/local-model-proof.txt'})});assert.ok([401,403].includes(unsigned.status));
  const conflict=fs.target(record,folder+'/保存冲突.txt');await fs.writeText(conflict,'BASE\n',{kind:'createIfAbsent'},null,policy);
  const baseline=(await callFile('fs.read',{path:conflict.ssh.path})).data.value.mtimeMs;
  await fs.writeText(conflict,'NEWER\n',null,null,policy);
  const write=await fetch(auth.origin+'/sidebar/write?'+new URLSearchParams({sessionId,path:conflict.ssh.path,expectedMtimeMs:String(baseline)}),{method:'POST',headers,body:'STALE\n'});assert.equal(write.status,409);assert.equal(await fs.readText(conflict),'NEWER\n');
  const directory=(await callFile('fs.mkdir',{path:folder,name:'中文 子目录'})).data.value.path;
  const created=(await callFile('fs.createFile',{path:directory,name:'original.txt'})).data.value.path;
  const renamed=await callFile('fs.rename',{path:created,name:'renamed.txt'});assert.equal(renamed.status,200);
  assert.equal((await callFile('fs.remove',{path:directory})).status,200);
  const bytes=Buffer.from([0,1,2,255,10,65]), upload=await fetch(auth.origin+'/sidebar/upload?'+new URLSearchParams({sessionId,dir:folder,relativePath:'upload.bin'}),{method:'POST',headers,body:bytes});assert.equal(upload.status,200);
  const download=await fetch(auth.origin+'/sidebar/file?'+new URLSearchParams({sessionId,path:folder+'/upload.bin'}),{headers});assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
  assert.equal(await page.getByText('SSH 文件', {exact: true}).count(), 0);
  const sessions = (await auth.api({action: 'sessions'})).data; assert.equal(sessions.length, 1); assert.deepEqual(await readdir(sessions[0].localRoot), []);
  assert.deepEqual(errors, []);
  await page.screenshot({path: join(artifacts, 'existing-files-remote.png'), fullPage: true});
  const local=await mkdtemp(join(tmpdir(),'dsh-local-files-'));await writeFile(join(local,'local-only.txt'),'LOCAL_WORKSPACE_UNCHANGED\n');
  await page.getByRole('button',{name:'添加工作区',exact:true}).click();await dialog.getByRole('button',{name:/本地文件夹/}).click();await dialog.getByLabel('本地文件夹绝对路径',{exact:true}).fill(local);await dialog.getByRole('button',{name:'创建本地工作区',exact:true}).click();await dialog.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'选择工作区',exact:true}).filter({hasText:local.split(/[\\/]/).at(-1)}).waitFor();
  const openSidebar=page.getByRole('button',{name:'打开右侧边栏',exact:true});if(await openSidebar.isVisible())await openSidebar.click();
  await page.getByRole('button',{name:/^文件$/}).click();await page.getByText('local-only.txt',{exact:true}).filter({visible:true}).first().click();
  await page.locator('.cm-content:visible').filter({hasText:'LOCAL_WORKSPACE_UNCHANGED'}).waitFor();
  assert.deepEqual(errors,[]);
  await writeFile(join(artifacts, 'better-sidebar-result.json'), JSON.stringify({localModel:true,existingFilesTree:true,existingEditorRemoteSave:true,remoteWatch:true,staleSaveRejected:true,nativeAuthentication:true,workspaceBoundary:true,fileMutations:true,binaryUploadDownload:true,localFilesUnchanged:true,noSshFilesEntry:true,noIframe:true,errors}, null, 2));
  console.log('PASS: existing Files UI browses and saves remote files, auto-refreshes, preserves local files, and enforces auth/conflicts/boundaries.');
} catch (error) {
  await writeFile(join(home, 'failure.txt'), await page.locator('body').innerText());
  await page.screenshot({path: join(artifacts, 'local-workspace-failure.png'), fullPage: true}).catch(()=>{}); console.error(host.log); console.error('Diagnostic directory: ' + home); throw error;
} finally { await browser.close(); await host.stop(); mounts.dispose(); }

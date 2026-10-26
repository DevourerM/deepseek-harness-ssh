import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import ssh2 from 'ssh2';
import {ConfigStore, parseConfig, localPath} from '../src/host/config.js';
import {RemoteManager} from '../src/host/manager.js';
import {fingerprintOf, endpointOf, exec, nodeCommand} from '../src/host/ssh.js';
const alias = process.argv[2];
const host = parseConfig(await readFile(join(homedir(), '.ssh/config'), 'utf8')).find(h => h.alias === alias);
if (!host?.identityFile) throw Error('Verification expects an existing key-auth SSH alias');
const deployed = JSON.parse(await readFile(join(import.meta.dirname, '../artifacts/server-deployment.json'), 'utf8'));
if (deployed.alias !== alias) throw Error('Deployment alias mismatch');
const known = execFileSync('ssh-keygen', ['-F', endpointOf(host), '-f', join(homedir(), '.ssh/known_hosts')], {encoding: 'utf8'});
const trusted = new Set(known.split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => line.split(/\s+/)[2]));
let fingerprint;
const verifier = new ssh2.Client(); verifier.on('error', () => {});
await new Promise(async (resolve, reject) => {
  verifier.once('error', reject); verifier.once('ready', resolve);
  verifier.connect({host: host.hostname, port: host.port, username: host.username, privateKey: await readFile(localPath(host.identityFile)), readyTimeout: 15000,
    hostVerifier: raw => { if (!trusted.has(raw.toString('base64'))) return false; fingerprint = fingerprintOf(raw); return true; }});
}); verifier.destroy();
const root = join(import.meta.dirname, '../artifacts/real-server'); await mkdir(root, {recursive: true});
const store = new ConfigStore(root); await store.init();
const text = `Host ${alias}\n HostName ${host.hostname}\n User ${host.username}\n Port ${host.port}\n IdentityFile "${host.identityFile}"\n NodePath "${deployed.nodePath}"\n`;
await store.save(text, (await store.get()).revision); await store.pin(endpointOf(host), fingerprint);
const manager = new RemoteManager(store);
try {
  const check = await manager.check(alias); assert.equal(check.ready, true, JSON.stringify(check)); console.log('PASS: real SSH/SFTP/runtime check', JSON.stringify(check));
  const c = await manager.ssh.connect(alias); let folder;
  try {
    const result = await exec(c, nodeCommand(c.host, async () => {
      const {homedir} = await import('node:os'), {join} = await import('node:path'), {mkdir, writeFile} = await import('node:fs/promises');
      const folder = join(homedir(), '.dsh-ssh/validation/workspace'); await mkdir(folder, {recursive: true});
      await writeFile(join(folder, 'dsh-ssh-proof.txt'), 'REAL_ROCKY_LINUX_SSH_WORKSPACE_OK\n'); console.log(folder);
    })); folder = result.stdout.trim();
  } finally { c.close(); }
  if (process.argv.includes('--browser')) {
    const setup = await manager.ssh.connect(alias);
    try { await exec(setup, nodeCommand(setup.host, async folder => {
      const {homedir} = await import('node:os'), {join} = await import('node:path'), {createHash} = await import('node:crypto'), {writeFile, readFile} = await import('node:fs/promises');
      if (folder !== join(homedir(), '.dsh-ssh/validation/workspace')) throw Error('Validation fixture path mismatch');
      const key = createHash('sha256').update(folder).digest('hex').slice(0, 24), profile = join(homedir(), '.dsh-ssh/workspaces', key, 'profiles/web');
      const model = join(profile, 'validation-model.mjs'), sdk = join(homedir(), '.dsh-ssh/runtime/0.2.1-rc.3/node_modules/@deepseek-ai/dsh-llm/lib/index.js');
      await writeFile(model, `import {LlmAdapter} from ${JSON.stringify(sdk)};export const inject=['llm'];class Test extends LlmAdapter{async listModels(){return [{provider:'ssh-validation',id:'test',name:'SSH validation',context:{contextWindow:100000}}]}async *stream(options){if(options.messages.at(-1)?.role!=='tool'){yield {type:'tool-call-delta',index:0,id:'real-read',name:'read',argumentsDelta:JSON.stringify({file_path:'dsh-ssh-proof.txt'})};yield {type:'finish',reason:{kind:'tool-calls'}}}else{yield {type:'text-delta',index:0,text:JSON.stringify(options.messages.at(-1)).includes('REAL_ROCKY_LINUX_SSH_WORKSPACE_OK')?'REAL_REMOTE_NATIVE_READ_OK':'READ_FAILED'};yield {type:'finish',reason:{kind:'stop'}}}}}export function apply(ctx){ctx.llm.registerAdapter(['ssh-validation'],new Test())}`);
      const patch = join(profile, 'cordis.patch.yml'), previous = await readFile(patch, 'utf8');
      if (!previous.includes('ssh-validation-model')) await writeFile(patch, previous + '\n- id: agent-default-model\n  config:\n    provider: ssh-validation\n    model: test\n- id: locale\n  config:\n    preference: zh\n- insert:\n    - id: ssh-validation-model\n      name: ' + JSON.stringify(model) + '\n');
    }, [folder])); } finally { setup.close(); }
  }
  const session = await manager.open(alias, folder);
  const response = await fetch(session.url, {redirect: 'manual'}); assert.equal(response.status, 303);
  const cookie = response.headers.getSetCookie().map(x => x.split(';')[0]).join('; '), origin = new URL(session.url).origin;
  assert.ok(cookie.startsWith('dsh-auth-'));
  const html = await fetch(origin, {headers: {Cookie: cookie}}); assert.equal(html.status, 200); assert.ok((await html.text()).includes('DeepSeek Harness'));
  assert.equal((await fetch(origin, {redirect: 'manual'})).status, 401);
  const result = {alias, check, productionBootstrap: true, authenticatedRemoteHost: true, folder, fingerprint, config: text};
  if (process.argv.includes('--browser')) {
    const {root: project} = await import('./env.mjs');
    const {resolve} = await import('node:path');
    const {chromium} = await import(pathToFileURL(process.env.SSH_PLAYWRIGHT || resolve(project, '../tree-chat/artifacts/browser-tools/node_modules/playwright/index.mjs')).href);
    const browser = await chromium.launch({headless: true});
    try {
      const page = await browser.newPage({viewport: {width: 1440, height: 960}}), errors = []; page.setDefaultTimeout(30000); page.on('pageerror', e => errors.push(e.message));
      await page.goto(session.url, {waitUntil: 'networkidle'});
      for (let i = 0; i < 3; i++) { const button = page.getByRole('button', {name: /^(继续|稍后配置)$/}).first(); try { await button.waitFor({state: 'visible', timeout: 3000}); await button.click(); } catch { break; } }
      const prompt = page.getByRole('dialog').filter({hasText: '开始使用'}); if (await prompt.count()) await prompt.getByRole('button', {name: '关闭', exact: true}).click();
      await page.getByText(`workspace [SSH ${alias}]`, {exact: true}).first().click();
      await page.locator('[contenteditable=true]:visible').last().fill('验证真实远端文件读取'); await page.locator('[contenteditable=true]:visible').last().press('Enter');
      await page.getByText('REAL_REMOTE_NATIVE_READ_OK', {exact: true}).first().waitFor({timeout: 60000});
      await page.getByRole('button', {name: '打开右侧边栏', exact: true}).click(); await page.getByRole('button', {name: /^工作区文件/}).click();
      await page.locator('[data-files-state="tree"]').getByText('dsh-ssh-proof.txt', {exact: true}).click();
      await page.getByText('REAL_ROCKY_LINUX_SSH_WORKSPACE_OK', {exact: true}).filter({visible: true}).first().waitFor();
      await page.screenshot({path: join(root, 'browser-preview.png'), fullPage: true}); assert.deepEqual(errors, []);
      result.nativeModelReadTool = true; result.nativeFilePreview = true; result.browserErrors = errors;
      console.log('PASS: real Linux native model read tool and native file preview');
    } finally { await browser.close(); }
  }
  await writeFile(join(root, 'result.json'), JSON.stringify(result, null, 2)); console.log('PASS: real production bootstrap and authenticated remote Host through SSH');
} finally { manager.dispose(); }

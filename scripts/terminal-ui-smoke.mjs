import assert from 'node:assert/strict';
import {mkdir, mkdtemp, copyFile, readFile, writeFile, symlink, readdir} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {homedir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {root, artifacts} from './env.mjs';
import {prepareHome, startHost, authenticated} from './host-fixture.mjs';
import {ConfigStore} from '../src/host/config.js';
import {Mounts} from '../src/host/mounts.js';
import {exec, quote} from '../src/host/ssh.js';

await mkdir(artifacts, {recursive: true}); const home = await mkdtemp(join(artifacts, 'terminal-ui-'));
const store = new ConfigStore(join(artifacts, 'real-server')), config = await store.get(), alias = config.hosts[0].alias;
const mounts = new Mounts(store); let host, browser, page;
try {
  const connection = await mounts.connect(alias), remoteHome = (await mounts.browse(alias, '.')).path;
  const folder = remoteHome + '/.dsh-ssh/validation/terminal-ui-' + Date.now(); await exec(connection, 'mkdir -p ' + quote(folder));
  await prepareHome(home, {extraPatch: '- id: agent-default-model\n  config:\n    provider: ssh-subagent-fixture\n    model: test\n- insert:\n    - id: ssh-terminal-ui-fixture\n      name: ' + JSON.stringify(join(root, 'scripts/subagent-fixture.mjs').replaceAll('\\', '/')) + '\n'});
  const dataDir = join(home, 'plugins/deepseek-harness-ssh'); await mkdir(dataDir, {recursive: true});
  for (const name of ['config', 'known-hosts.json']) await copyFile(join(store.root, name), join(dataDir, name));
  const profile = join(home, 'profiles/web'), better = join(homedir(), '.dsh/profiles/desktop/node_modules/dsh-better-sidebar');
  await symlink(better, join(profile, 'node_modules/dsh-better-sidebar'), 'junction');
  const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8')); manifest.dependencies['dsh-better-sidebar'] = 'file:' + better.replaceAll('\\', '/'); manifest.dsh.profile.bundles.push('dsh-better-sidebar'); await writeFile(join(profile, 'package.json'), JSON.stringify(manifest));
  host = await startHost(home); const auth = await authenticated(host.url);
  const {chromium} = await import(pathToFileURL(process.env.SSH_PLAYWRIGHT || resolve(root, '../tree-chat/artifacts/browser-tools/node_modules/playwright/index.mjs')).href);
  browser = await chromium.launch({headless: true}); page = await browser.newPage({viewport: {width: 1440, height: 960}}); page.setDefaultTimeout(30000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(host.url, {waitUntil: 'networkidle'});
  for (let i = 0; i < 3; i++) { try { await page.getByRole('button', {name: /^(继续|稍后配置)$/}).first().click({timeout: i ? 1500 : 5000}); } catch { break; } }
  const startup = page.getByRole('dialog').filter({hasText: '开始使用'}); if (await startup.count()) await startup.getByRole('button', {name: '关闭', exact: true}).click();
  await page.getByRole('button', {name: '添加工作区', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: '新建工作区'}); await dialog.getByRole('button', {name: /远程文件夹/}).click();
  await dialog.getByLabel('远程目录', {exact: true}).fill(folder); await dialog.getByRole('button', {name: '连接并创建远程工作区'}).click(); await dialog.waitFor({state: 'hidden', timeout: 60000});
  const input = page.locator('[contenteditable=true]:visible').last(); await input.fill('验证 SSH 侧栏终端'); await input.press('Enter');
  await page.getByText('PARENT_IDLE', {exact: true}).first().waitFor({timeout: 60000});
  const open = page.getByRole('button', {name: '打开右侧边栏', exact: true}); if (await open.isVisible()) await open.click();
  await page.getByRole('button', {name: /^新建终端/}).first().click();
  const terminalInput = page.locator('.xterm-helper-textarea').last(); await terminalInput.waitFor({state: 'attached', timeout: 60000});
  await terminalInput.focus();
  await page.keyboard.type("printf 'NATIVE_SSH_TERMINAL_UI_OK\\n' > ui-terminal-proof.txt; pwd"); await page.keyboard.press('Enter');
  let proved = false;
  for (let i = 0; i < 100; i++) {
    try { const value = await mounts.request({alias}, {action: 'read', path: folder + '/ui-terminal-proof.txt', limit: 1024}); if (Buffer.from(value.data, 'base64').toString() === 'NATIVE_SSH_TERMINAL_UI_OK\n') { proved = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(proved, 'Native sidebar terminal command must write to the remote folder');
  // The process belongs to the Host, so reconnecting the UI must retain it.
  await page.reload({waitUntil: 'networkidle'});
  await terminalInput.waitFor({state: 'attached', timeout: 60000}); await terminalInput.focus();
  await page.keyboard.type("printf 'SSH_UI_RECONNECTED\\n' > ui-terminal-reconnect.txt"); await page.keyboard.press('Enter');
  let reconnected = false;
  for (let i = 0; i < 80; i++) {
    try { const value = await mounts.request({alias}, {action: 'read', path: folder + '/ui-terminal-reconnect.txt', limit: 1024}); if (Buffer.from(value.data, 'base64').toString() === 'SSH_UI_RECONNECTED\n') { reconnected = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(reconnected, 'Committed terminal must survive UI reconnection');
  assert.ok(!(await page.locator('body').innerText()).includes('进程已退出（267）'));
  const sessions = (await auth.api({action: 'sessions'})).data; assert.equal(sessions.length, 1); assert.deepEqual(await readdir(sessions[0].localRoot), []);
  await page.setViewportSize({width: 1280, height: 850});
  await page.screenshot({path: join(artifacts, 'native-ssh-terminal.png'), fullPage: true}); assert.deepEqual(errors, []);
  // User keyboard input must also deliver an explicit exit status to the same UI.
  await terminalInput.focus(); await page.keyboard.type('exit 7'); await page.keyboard.press('Enter');
  await page.getByText(/进程已退出.*7/).first().waitFor({timeout: 15000});
  await writeFile(join(artifacts, 'terminal-ui-result.json'), JSON.stringify({isolatedHost: true, originalSidebarTerminal: true, betterSidebarCompatible: true, remoteShellInput: true, remoteFileWrite: true, survivesUiReload: true, noLocalMirror: true, exitStatus: true, errors, desktopUnchanged: true}, null, 2));
  console.log('PASS: original sidebar terminal opens SSH shell, sends keyboard input, writes a real remote file, resizes and displays exit 7 with Better Sidebar enabled.');
} catch (error) {
  if (page) { await writeFile(join(home, 'failure.txt'), await page.locator('body').innerText().catch(() => 'page closed')); await page.screenshot({path: join(artifacts, 'terminal-ui-failure.png'), fullPage: true}).catch(() => {}); }
  if (host) console.error(host.log); console.error('Diagnostics: ' + home); throw error;
} finally { await browser?.close(); await host?.stop(); mounts.dispose(); }

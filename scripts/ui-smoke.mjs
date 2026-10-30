import assert from 'node:assert/strict';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {request as httpRequest} from 'node:http';
import {root, artifacts, runtimeVersion} from './env.mjs';
import {prepareHome, startHost} from './host-fixture.mjs';
import {sshFixture} from '../test/ssh-fixture.mjs';

await mkdir(artifacts, {recursive: true}); const home = await mkdtemp(join(artifacts, 'ui-home-'));
const hostVersion = runtimeVersion();
const remoteRoot = await mkdtemp(join(artifacts, 'remote-files-')); await mkdir(join(remoteRoot, 'project 空格'));
await writeFile(join(remoteRoot, 'project 空格', 'remote-proof.txt'), 'DSH SSH remote file preview verification\n');
const ssh = await sshFixture(remoteRoot, {onExec: (_command, stream) => {stream.write('3.9.21\n'); stream.exit(0); stream.end();}});
await prepareHome(home); const host = await startHost(home);
const {chromium} = await import(pathToFileURL(process.env.SSH_PLAYWRIGHT || resolve(root, '../tree-chat/artifacts/browser-tools/node_modules/playwright/index.mjs')).href);
const browser = await chromium.launch({headless: true, ...(process.env.SSH_CHROMIUM ? {executablePath: process.env.SSH_CHROMIUM} : {})});
const page = await browser.newPage({viewport: {width: 1440, height: 960}}), errors = [];
page.setDefaultTimeout(20000); page.on('pageerror', e => errors.push(e.message));
async function dismissStartup(target) {
  for (let i = 0; i < 3; i++) { const button = target.getByRole('button', {name: /^(继续|稍后配置)$/}).first(); try { await button.waitFor({state: 'visible', timeout: i === 0 ? 5000 : 1500}); await button.click(); } catch { break; } }
  const prompt = target.getByRole('dialog').filter({hasText: '开始使用'});
  if (await prompt.count()) await prompt.getByRole('button', {name: '关闭', exact: true}).click();
}
try {
  // localhost top-level + 127.0.0.1 iframe intentionally exercises cross-site
  // cookie behavior, matching the desktop dsh-app:// versus loopback boundary.
  await page.goto(host.url.replace('127.0.0.1', 'localhost'), {waitUntil: 'networkidle'}); await dismissStartup(page);
  await writeFile(join(artifacts, 'ui-initial.txt'), await page.locator('body').innerText());
  await writeFile(join(artifacts, 'ui-buttons.json'), JSON.stringify(await page.getByRole('button').evaluateAll(nodes => nodes.map(n => ({text: n.textContent, label: n.getAttribute('aria-label'), title: n.getAttribute('title')}))), null, 2));
  await page.getByRole('button', {name: '账号菜单', exact: true}).click();
  await writeFile(join(artifacts, 'ui-menu.txt'), await page.locator('body').innerText());
  await page.getByText('设置', {exact: true}).click();
  await page.getByText('SSH 远程工作区', {exact: true}).first().click();
  const settings = page.locator('.ds-ssh-settings'); await settings.waitFor();
  await settings.getByRole('textbox', {name: 'SSH 连接配置'}).fill(`Host local-ssh-test\n HostName 127.0.0.1\n User tester\n Port ${ssh.port}\n IdentityAgent none`);
  await settings.getByRole('button', {name: '保存配置', exact: true}).click(); await settings.getByText('已保存', {exact: true}).waitFor();
  await settings.getByRole('button', {name: '检查连接', exact: true}).click();
  await settings.getByText('确认远端主机身份', {exact: true}).waitFor();
  await page.screenshot({path: join(artifacts, 'ssh-host-trust.png'), fullPage: true});
  await settings.getByRole('button', {name: '指纹一致，信任并继续'}).click();
  await settings.getByLabel('SSH 登录密码', {exact: true}).fill('wrong-first-attempt');
  await settings.getByRole('button', {name: '验证并继续', exact: true}).click();
  await settings.getByText('认证未通过，请重新输入', {exact: true}).waitFor();
  await settings.getByLabel('SSH 登录密码', {exact: true}).fill('test-password');
  await settings.getByRole('button', {name: '验证并继续', exact: true}).click();
  await settings.getByText('连接检查通过，可创建远程工作区', {exact: true}).waitFor();
  await writeFile(join(artifacts, 'settings-geometry.json'), JSON.stringify(await settings.evaluate(node => [...node.querySelectorAll('details,details p,select')].map(el => ({tag: el.tagName, rect: el.getBoundingClientRect().toJSON(), whiteSpace: getComputedStyle(el).whiteSpace, width: getComputedStyle(el).width, minWidth: getComputedStyle(el).minWidth}))), null, 2));
  await page.screenshot({path: join(artifacts, 'ssh-settings.png'), fullPage: true});
  // Close the native settings sheet using its own close button.
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name: '添加工作区', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: '新建工作区'}); await dialog.waitFor();
  await page.screenshot({path: join(artifacts, 'ssh-workspace-choice.png'), fullPage: true});
  await dialog.getByRole('button', {name: /远程文件夹/}).click();
  await dialog.getByRole('button', {name: '浏览目录', exact: true}).click();
  await dialog.getByRole('button', {name: '▸ project 空格', exact: true}).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.ds-ssh-dialog input')].some(n => n.value === '/project 空格'));
  await page.screenshot({path: join(artifacts, 'ssh-folder-browser.png'), fullPage: true});
  await dialog.getByRole('button', {name: '关闭新建工作区'}).click();
  await page.getByRole('button', {name: '添加工作区', exact: true}).click();
  await dialog.getByRole('button', {name: '本地文件夹 在这台电脑上工作', exact: true}).click();
  await dialog.getByLabel('本地文件夹绝对路径', {exact: true}).fill(remoteRoot);
  await dialog.getByRole('button', {name: '创建本地工作区', exact: true}).click();
  await dialog.waitFor({state: 'hidden'});
  assert.equal(await page.locator('iframe').count(), 0);
  assert.deepEqual(errors, []);
  await writeFile(join(artifacts, 'ui-result.json'), JSON.stringify({host: hostVersion, settings: true, hostTrust: true, missingPasswordPrompt: true, wrongPasswordRetry: true, sftpUnicodeBrowser: true, localWorkspaceCreation: true, noIframe: true, pageErrors: errors}, null, 2));
  console.log('PASS: native settings, host trust, password prompt and retry, Unicode SFTP browse and local folder creation.');
} catch (e) {
  await writeFile(join(artifacts, 'ui-failure.txt'), await page.locator('body').innerText().catch(() => 'page closed'));
  await page.screenshot({path: join(artifacts, 'ui-failure.png'), fullPage: true}).catch(() => {}); console.error(host.log); throw e;
} finally { await browser.close(); await host.stop(); await ssh.close(); }

import assert from 'node:assert/strict';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {request as httpRequest} from 'node:http';
import {root, artifacts} from './env.mjs';
import {prepareHome, startHost} from './host-fixture.mjs';
import {integratedSsh} from '../test/integration-fixture.mjs';

await mkdir(artifacts, {recursive: true}); const home = await mkdtemp(join(artifacts, 'ui-home-'));
const remoteRoot = await mkdtemp(join(artifacts, 'remote-files-')); await mkdir(join(remoteRoot, 'project 空格'));
await writeFile(join(remoteRoot, 'project 空格', 'remote-proof.txt'), 'DSH SSH remote file preview verification\n');
const ssh = await integratedSsh(remoteRoot, artifacts);
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
  await dialog.getByLabel('SSH 登录密码', {exact: true}).fill('test-password');
  await dialog.getByRole('button', {name: '验证并继续', exact: true}).click();
  await dialog.getByRole('button', {name: '▸ project 空格', exact: true}).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.ds-ssh-dialog input')].some(n => n.value === '/project 空格'));
  await assert.equal(await dialog.getByLabel('远程目录', {exact: true}).inputValue(), '/project 空格');
  await page.screenshot({path: join(artifacts, 'ssh-folder-browser.png'), fullPage: true});
  await dialog.getByRole('button', {name: '连接并创建远程工作区'}).click();
  const remote = page.frameLocator('iframe[title="SSH 远程工作区 local-ssh-test"]');
  await page.locator('.ds-ssh-remote iframe').waitFor({timeout: 90000});
  await remote.getByText('SSH local-ssh-test', {exact: true}).first().waitFor();
  await dismissStartup(remote);
  await remote.getByText('SSH local-ssh-test', {exact: true}).first().click();
  await remote.locator('[contenteditable=true]:visible').last().fill('读取 remote-proof.txt 验证远程工具');
  await remote.locator('[contenteditable=true]:visible').last().press('Enter');
  await remote.getByText('SSH_NATIVE_TOOL_READ_OK', {exact: true}).first().waitFor({timeout: 30000});
  const remoteCookies = (await page.context().cookies()).filter(c => c.domain === '127.0.0.1' && c.name.startsWith('dsh-auth-'));
  assert.ok(remoteCookies.some(c => c.partitionKey && c.secure && c.httpOnly && c.sameSite === 'None'), 'remote auth must be partitioned for cross-site desktop embedding');
  const remoteOrigin = new URL(await page.locator('.ds-ssh-remote iframe').getAttribute('src')).origin;
  assert.equal((await fetch(remoteOrigin + '/', {redirect: 'manual'})).status, 401, 'gateway must not authenticate unsigned requests');
  const cookie = remoteCookies.map(c => `${c.name}=${c.value}`).join('; ');
  assert.equal((await fetch(remoteOrigin + '/api/rpc', {method: 'POST', headers: {'Content-Type': 'application/json', Origin: 'https://attacker.invalid', Cookie: cookie}, body: '{}'})).status, 403, 'gateway must preserve native Origin rejection');
  const foreignHostStatus = await new Promise((resolve, reject) => { const req = httpRequest(remoteOrigin + '/', {headers: {Host: 'attacker.invalid'}}, res => { res.resume(); res.once('end', () => resolve(res.statusCode)); }); req.once('error', reject); req.end(); });
  assert.equal(foreignHostStatus, 403, 'gateway must reject foreign Host headers');
  await remote.getByRole('button', {name: '打开右侧边栏', exact: true}).click();
  await writeFile(join(artifacts, 'ui-remote-buttons.json'), JSON.stringify(await remote.getByRole('button').evaluateAll(nodes => nodes.map(n => ({text: n.textContent, label: n.getAttribute('aria-label')}))), null, 2));
  await remote.getByRole('button', {name: /^工作区文件/}).click();
  await remote.locator('[data-files-state="tree"]').getByText('remote-proof.txt', {exact: true}).click();
  await remote.getByText('DSH SSH remote file preview verification', {exact: true}).filter({visible: true}).first().waitFor();
  await writeFile(join(artifacts, 'remote-geometry.json'), JSON.stringify(await page.locator('.ds-ssh-remote-bar').evaluate(node => [node, ...node.children].map(el => ({tag: el.tagName, rect: el.getBoundingClientRect().toJSON(), position: getComputedStyle(el).position, transform: getComputedStyle(el).transform, alignSelf: getComputedStyle(el).alignSelf}))), null, 2));
  await page.screenshot({path: join(artifacts, 'ssh-remote-workspace.png'), fullPage: true});
  await writeFile(join(artifacts, 'ui-remote.txt'), await remote.locator('body').innerText());
  await page.getByRole('button', {name: '返回本地', exact: true}).click();
  await page.locator('.ds-ssh-remote').waitFor({state: 'hidden'});
  await page.getByRole('button', {name: '添加工作区', exact: true}).click();
  await dialog.getByRole('button', {name: '本地文件夹 在这台电脑上工作', exact: true}).click();
  await dialog.getByLabel('本地文件夹绝对路径', {exact: true}).fill(remoteRoot);
  await dialog.getByRole('button', {name: '创建本地工作区', exact: true}).click();
  await dialog.waitFor({state: 'hidden'});
  await page.getByText(remoteRoot.split(/[\\/]/).at(-1), {exact: true}).first().waitFor();
  // Reopen the still-connected remote view, then drop the actual SSH transport.
  await page.getByRole('button', {name: '账号菜单', exact: true}).click(); await page.getByText('设置', {exact: true}).click();
  await page.getByText('SSH 远程工作区', {exact: true}).first().click();
  await page.locator('.ds-ssh-settings').getByRole('button', {name: '打开', exact: true}).click();
  await page.locator('.ds-ssh-remote iframe').waitFor(); ssh.drop();
  await page.getByText('远程连接已断开', {exact: true}).waitFor({timeout: 15000});
  assert.equal(await page.locator('.ds-ssh-remote iframe').count(), 0);
  await page.screenshot({path: join(artifacts, 'ssh-disconnected.png'), fullPage: true});
  assert.deepEqual(errors, []);
  await writeFile(join(artifacts, 'ui-result.json'), JSON.stringify({host: '0.2.1-rc.3', crossSitePartitionedAuthentication: true, nativeAuthAndOriginRejection: true, gatewayHostRejection: true, settings: true, hostTrust: true, sftpBrowse: true, nativeFilePreview: true, nativeModelReadTool: true, localWorkspaceCreation: true, returnLocal: true, reopenRemote: true, sshDisconnectBlocksRemoteUi: true, pageErrors: errors}, null, 2));
  console.log('PASS: native settings, host trust, SSH/SFTP browser, native model file read, native file preview, local creation, return/reopen and real SSH disconnection.');
} catch (e) {
  await writeFile(join(artifacts, 'ui-failure.txt'), await page.locator('body').innerText().catch(() => 'page closed'));
  await writeFile(join(artifacts, 'ui-remote-failure.txt'), await page.frameLocator('iframe').locator('body').innerText().catch(() => 'remote unavailable'));
  await page.screenshot({path: join(artifacts, 'ui-failure.png'), fullPage: true}).catch(() => {}); console.error(host.log); throw e;
} finally { await browser.close(); await host.stop(); await ssh.close(); }

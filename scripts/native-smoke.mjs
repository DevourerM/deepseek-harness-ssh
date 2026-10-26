import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {root, artifacts} from './env.mjs';
const launch = JSON.parse(await readFile(join(artifacts, 'native-launch.json'), 'utf8'));
const {chromium} = await import(pathToFileURL(process.env.SSH_PLAYWRIGHT || resolve(root, '../tree-chat/artifacts/browser-tools/node_modules/playwright/index.mjs')).href);
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.port}`);
const pages = browser.contexts().flatMap(c => c.pages()), page = pages.find(p => p.url().startsWith('dsh-app://app/'));
if (!page) { console.log(JSON.stringify(pages.map(p => new URL(p.url()).origin))); throw Error('Native DSH app page is not ready'); }
page.setDefaultTimeout(30000);
const result = {nativeDesktop: true, origin: new URL(page.url()).origin};
const deployed = JSON.parse(await readFile(join(artifacts, 'real-server/result.json'), 'utf8'));
try {
  await writeFile(join(artifacts, 'native-buttons.json'), JSON.stringify(await page.getByRole('button').evaluateAll(nodes => nodes.map(n => ({label: n.getAttribute('aria-label'), title: n.getAttribute('title')}))), null, 2));
  const settings = page.locator('.ds-ssh-settings');
  if (!await settings.isVisible()) { await page.getByRole('button', {name: '账号菜单', exact: true}).click(); await page.getByText('设置', {exact: true}).click(); await page.getByText('SSH 远程工作区', {exact: true}).first().click(); }
  await settings.waitFor();
  const config = await settings.getByRole('textbox', {name: 'SSH 连接配置'}).inputValue(); assert.ok(config.includes('Host ' + deployed.alias));
  await settings.getByRole('button', {name: '检查连接', exact: true}).click(); await settings.getByText('连接检查通过，可创建远程工作区', {exact: true}).waitFor({timeout: 60000});
  await page.screenshot({path: join(artifacts, 'native-ssh-settings.png'), fullPage: true});
  result.settingsLoaded = true; result.realServerCheck = true;
  if (process.argv.includes('--remote')) {
    await page.keyboard.press('Escape'); await page.getByRole('button', {name: '添加工作区', exact: true}).click();
    const dialog = page.getByRole('dialog', {name: '新建工作区'}); await dialog.getByRole('button', {name: /远程文件夹/}).click();
    await dialog.getByLabel('最近的远程工作区', {exact: true}).selectOption({index: 1});
    await dialog.getByRole('button', {name: '连接并创建远程工作区', exact: true}).click();
    await page.locator('.ds-ssh-remote iframe').waitFor({timeout: 210000});
    const remote = page.frameLocator('.ds-ssh-remote iframe');
    const title = deployed.check.home.split('/').at(-1) + ` [SSH ${deployed.alias}]`;
    await remote.getByText(title, {exact: true}).first().waitFor({timeout: 90000});
    result.remoteEmbedded = true; result.realCustomSchemeAuthentication = true;
    await page.screenshot({path: join(artifacts, 'native-real-remote.png'), fullPage: true});
    console.log('PASS: real Linux Host renders inside actual dsh-app desktop with native authentication.');
  }
  await writeFile(join(artifacts, 'native-result.json'), JSON.stringify(result, null, 2)); console.log('PASS: installed plugin loads and checks real server in actual DSH desktop.');
} catch (error) { await page.screenshot({path: join(artifacts, 'native-failure.png'), fullPage: true}).catch(() => {}); throw error; }
// Disconnect CDP without closing the user's application.
await browser.close();

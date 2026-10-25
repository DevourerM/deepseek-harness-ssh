import assert from 'node:assert/strict';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {root, artifacts} from './env.mjs';
import {prepareHome, startHost} from './host-fixture.mjs';
await mkdir(artifacts, {recursive: true}); const home = await mkdtemp(join(artifacts, 'install-home-'));
await prepareHome(home, {plugin: false}); const host = await startHost(home);
const {chromium} = await import(pathToFileURL(process.env.SSH_PLAYWRIGHT || resolve(root, '../tree-chat/artifacts/browser-tools/node_modules/playwright/index.mjs')).href);
const browser = await chromium.launch({headless: true, ...(process.env.SSH_CHROMIUM ? {executablePath: process.env.SSH_CHROMIUM} : {})});
const page = await browser.newPage({viewport: {width: 1440, height: 960}}), errors = []; page.setDefaultTimeout(20000); page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(host.url, {waitUntil: 'networkidle'});
  for (let i = 0; i < 3; i++) {
    const button = page.getByRole('button', {name: /^(继续|稍后配置)$/}).first();
    try { await button.waitFor({state: 'visible', timeout: i === 0 ? 5000 : 1500}); await button.click(); } catch { break; }
  }
  const prompt = page.getByRole('dialog').filter({hasText: '开始使用'}); if (await prompt.count()) await prompt.getByRole('button', {name: '关闭', exact: true}).click();
  await page.getByText('插件', {exact: true}).first().click();
  await page.getByRole('button', {name: '添加插件', exact: true}).click();
  await page.getByRole('textbox', {name: '包名或地址', exact: true}).fill(join(root, 'dist/deepseek-harness-ssh-0.1.0.tgz'));
  await page.getByRole('button', {name: '安装', exact: true}).click();
  await page.getByText('deepseek-harness-ssh', {exact: true}).first().waitFor({timeout: 120000});
  const enable = page.getByRole('button', {name: '立即启用', exact: true}); await enable.waitFor({timeout: 120000}); await enable.click(); await enable.waitFor({state: 'hidden'});
  await page.screenshot({path: join(artifacts, 'software-install.png'), fullPage: true});
  await page.getByRole('button', {name: '账号菜单', exact: true}).click(); await page.getByText('设置', {exact: true}).click();
  await page.getByText('SSH 远程工作区', {exact: true}).first().click(); await page.locator('.ds-ssh-settings').waitFor();
  await page.screenshot({path: join(artifacts, 'installed-ssh-settings.png'), fullPage: true});
  assert.deepEqual(errors, []);
  await writeFile(join(artifacts, 'install-result.json'), JSON.stringify({host: '0.2.1-rc.3', package: 'deepseek-harness-ssh-0.1.0.tgz', installedThroughUi: true, enabled: true, settingsVisible: true, pageErrors: errors}, null, 2));
  console.log('PASS: tgz installed and enabled through real DSH Plugins UI; installed SSH settings are visible.');
} catch (e) { await writeFile(join(artifacts, 'install-failure.txt'), await page.locator('body').innerText()); await page.screenshot({path: join(artifacts, 'install-failure.png'), fullPage: true}).catch(() => {}); console.error(host.log); throw e; }
finally { await browser.close(); await host.stop(); }

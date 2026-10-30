import assert from 'node:assert/strict';
import {mkdir, mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {root, artifacts, runtimeVersion} from './env.mjs';
import {prepareHome, startHost} from './host-fixture.mjs';
await mkdir(artifacts, {recursive: true});
// Keep the isolated DSH_HOME outside this repository: a profile nested inside
// this package would make Node self-resolve "deepseek-harness-ssh" to the
// checkout instead of the installed copy during profile HMR.
const home = await mkdtemp(join(tmpdir(), 'dsh-ssh-install-'));
const {version} = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')), packageName = `deepseek-harness-ssh-${version}.tgz`;
const hostVersion = runtimeVersion();
await prepareHome(home, {plugin: false}); const host = await startHost(home);
const {chromium} = await import(pathToFileURL(process.env.SSH_PLAYWRIGHT || resolve(root, '../tree-chat/artifacts/browser-tools/node_modules/playwright/index.mjs')).href);
const browser = await chromium.launch({headless: true, ...(process.env.SSH_CHROMIUM ? {executablePath: process.env.SSH_CHROMIUM} : {})});
const page = await browser.newPage({viewport: {width: 1440, height: 960}}), errors = []; page.setDefaultTimeout(20000); page.on('pageerror', e => errors.push(e.message));
let succeeded = false;
try {
  await page.goto(host.url, {waitUntil: 'networkidle'});
  for (let i = 0; i < 3; i++) {
    const button = page.getByRole('button', {name: /^(继续|稍后配置)$/}).first();
    try { await button.waitFor({state: 'visible', timeout: i === 0 ? 5000 : 1500}); await button.click(); } catch { break; }
  }
  const prompt = page.getByRole('dialog').filter({hasText: '开始使用'}); if (await prompt.count()) await prompt.getByRole('button', {name: '关闭', exact: true}).click();
  await page.getByText('插件', {exact: true}).first().click();
  await page.getByRole('button', {name: '添加插件', exact: true}).click();
  await page.getByRole('textbox', {name: '包名或地址', exact: true}).fill(join(root, 'dist', packageName));
  await page.getByRole('button', {name: '安装', exact: true}).click();
  await page.getByText('deepseek-harness-ssh', {exact: true}).first().waitFor({timeout: 120000});
  const enable = page.getByRole('button', {name: '立即启用', exact: true}); await enable.waitFor({timeout: 120000}); await enable.click(); await enable.waitFor({state: 'hidden', timeout: 120000});
  await page.waitForLoadState('networkidle').catch(() => {});
  assert.ok(!/incompatible|skipping profile bundle|did not activate|ERR_MODULE/i.test(host.log), 'DSH ' + hostVersion + ' must activate the installed profile bundle:\n' + host.log);
  const installed = JSON.parse(await readFile(join(home, 'profiles/web/node_modules/deepseek-harness-ssh/package.json'), 'utf8'));
  assert.equal(installed.version, version, 'installed package version');
  // Prove the host entry really activated: the authenticated plugin API only exists after apply().
  let api;
  for (let i = 0; i < 20; i++) {
    try {
      api = await page.evaluate(async () => {
        const response = await fetch('/api/dsh-ssh', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action: 'config'})});
        return {status: response.status, data: await response.json()};
      });
      if (api.status === 200) break;
    } catch { /* profile reload may replace the page execution context */ }
    await page.waitForTimeout(1000);
  }
  assert.equal(api?.status, 200, 'host plugin API after enable: ' + JSON.stringify(api));
  assert.deepEqual(api.data.hosts, [], 'fresh install starts with no hosts');
  await page.screenshot({path: join(artifacts, 'software-install.png'), fullPage: true});
  await page.getByRole('button', {name: '账号菜单', exact: true}).click(); await page.getByText('设置', {exact: true}).click();
  await page.getByText('SSH 远程工作区', {exact: true}).first().click(); await page.locator('.ds-ssh-settings').waitFor();
  await page.screenshot({path: join(artifacts, 'installed-ssh-settings.png'), fullPage: true});
  assert.deepEqual(errors, []);
  await writeFile(join(artifacts, 'install-result.json'), JSON.stringify({host: hostVersion, home, package: packageName, installedVersion: installed.version, installedThroughUi: true, enabled: true, hostActive: true, settingsVisible: true, pageErrors: errors}, null, 2));
  succeeded = true;
  console.log('PASS: tgz installed and enabled through real DSH ' + hostVersion + ' Plugins UI; host plugin active, no incompatible/skipping warning; installed SSH settings are visible.');
} catch (e) {
  await writeFile(join(artifacts, 'install-failure.txt'), await page.locator('body').innerText().catch(() => 'page closed'));
  await writeFile(join(artifacts, 'install-host.log'), host.log);
  await page.screenshot({path: join(artifacts, 'install-failure.png'), fullPage: true}).catch(() => {});
  console.error(host.log); throw e;
} finally { await browser.close(); await host.stop(); if (succeeded) await rm(home, {recursive: true, force: true}); }

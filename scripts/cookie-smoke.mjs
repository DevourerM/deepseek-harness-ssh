import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {root} from './env.mjs';
const remote = createServer((req, res) => {
  if (req.url === '/cookie') { res.end(req.headers.cookie || 'NONE'); return; }
  res.setHeader('Set-Cookie', 'dsh-auth-test=proof; HttpOnly; SameSite=None; Secure; Partitioned; Path=/');
  res.end('<script>fetch("/cookie").then(r=>r.text()).then(value=>document.body.textContent=value)</script>');
});
await new Promise(resolve => remote.listen(0, '127.0.0.1', resolve));
const parent = createServer((req, res) => res.end(`<iframe src="http://127.0.0.1:${remote.address().port}/"></iframe>`));
await new Promise(resolve => parent.listen(0, '127.0.0.1', resolve));
const {chromium} = await import(pathToFileURL(process.env.SSH_PLAYWRIGHT || resolve(root, '../tree-chat/artifacts/browser-tools/node_modules/playwright/index.mjs')).href);
const browser = await chromium.launch({headless: true});
try {
  const page = await browser.newPage(); await page.goto(`http://localhost:${parent.address().port}/`);
  await page.frameLocator('iframe').getByText('dsh-auth-test=proof', {exact: true}).waitFor();
  const cookies = await page.context().cookies(); const cookie = cookies.find(c => c.name === 'dsh-auth-test');
  assert.equal(cookie.httpOnly, true); assert.equal(cookie.secure, true); assert.equal(cookie.sameSite, 'None'); assert.ok(cookie.partitionKey);
  console.log('PASS: cross-site loopback iframe accepts and sends Secure HttpOnly Partitioned cookie.');
} finally { await browser.close(); parent.closeAllConnections(); remote.closeAllConnections(); await new Promise(r => parent.close(r)); await new Promise(r => remote.close(r)); }

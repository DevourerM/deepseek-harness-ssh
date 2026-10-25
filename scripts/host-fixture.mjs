import {spawn} from 'node:child_process';
import {mkdir, writeFile, symlink, lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {root, runtimePath} from './env.mjs';

export async function prepareHome(home, {plugin = true, folder, alias = 'fixture', extraPatch = ''} = {}) {
  const profile = join(home, 'profiles/web'); await mkdir(join(profile, 'node_modules'), {recursive: true});
  if (plugin) {
    const target = join(profile, 'node_modules/deepseek-harness-ssh');
    if (!await lstat(target).catch(() => null)) await symlink(root, target, process.platform === 'win32' ? 'junction' : 'dir');
  }
  await writeFile(join(profile, 'package.json'), JSON.stringify({name: 'ssh-isolated-test', private: true, dependencies: plugin ? {'deepseek-harness-ssh': 'file:' + root.replaceAll('\\', '/')} : {}, dsh: {profile: {bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...(plugin ? ['deepseek-harness-ssh'] : [])]}}}));
  let patch = '- id: locale\n  config:\n    preference: zh\n';
  if (folder) {
    const seed = join(profile, 'seed.mjs');
    await writeFile(seed, `export const inject=['workspaceRegistry'];export async function apply(ctx){await ctx.workspaceRegistry.create(${JSON.stringify(folder)},${JSON.stringify('SSH ' + alias)});}`);
    patch += '- insert:\n    - id: ssh-test-seed\n      name: ' + JSON.stringify(seed.replaceAll('\\', '/')) + '\n';
  }
  await writeFile(join(profile, 'cordis.patch.yml'), patch + extraPatch);
  await writeFile(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n');
}
export async function startHost(home, {folder = root, trustedPort, timeout = 60000} = {}) {
  const rt = runtimePath();
  const args = [join(rt, '@deepseek-ai/dsh/lib/bin.js'), '--profile', 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'];
  if (trustedPort) args.push('--trusted-host', `127.0.0.1:${trustedPort}`);
  const child = spawn(process.execPath, args, {cwd: folder, env: {...process.env, DSH_HOME: home, NODE_PATH: rt}, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true});
  let tail = '';
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(Error('DSH startup timed out: ' + redact(tail))); }, timeout);
    const receive = data => { tail = (tail + data.toString()).slice(-16000); const match = tail.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/[^\s\x1b]*)/); if (match) { clearTimeout(timer); resolve(match[1]); } };
    child.stdout.on('data', receive); child.stderr.on('data', receive);
    child.once('error', e => { clearTimeout(timer); reject(e); });
    child.once('exit', code => { clearTimeout(timer); reject(Error(`DSH exited (${code}): ` + redact(tail))); });
  });
  return {child, url, get log() { return redact(tail); }, stop: async () => { if (child.exitCode !== null) return; child.kill(); await new Promise(resolve => { child.once('exit', resolve); setTimeout(resolve, 5000).unref(); }); }};
}
function redact(text) { return text.replace(/([?&]token=)[^\s]+/g, '$1[REDACTED]'); }
export async function authenticated(url) {
  const response = await fetch(url, {redirect: 'manual'});
  const cookie = response.headers.getSetCookie().map(c => c.split(';')[0]).join('; '), origin = new URL(url).origin;
  return {origin, cookie, async api(input) {
    const response = await fetch(origin + '/api/dsh-ssh', {method: 'POST', headers: {'Content-Type': 'application/json', Cookie: cookie, Origin: origin}, body: JSON.stringify(input)});
    return {status: response.status, data: await response.json()};
  }};
}

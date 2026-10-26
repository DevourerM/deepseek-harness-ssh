import {readFile, writeFile, mkdir, cp, rename, lstat} from 'node:fs/promises';
import {join, resolve, relative, isAbsolute} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {ConfigStore, parseConfig, atomicWrite} from '../src/host/config.js';
const root = resolve(import.meta.dirname, '..'), args = process.argv.slice(2);
const option = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const home = resolve(option('--home', join(homedir(), '.dsh'))), profile = join(home, 'profiles/desktop');
const manifestPath = join(profile, 'package.json'), original = await readFile(manifestPath, 'utf8'), manifest = JSON.parse(original);
if (!Array.isArray(manifest.dsh?.profile?.bundles)) throw Error('Not a DSH desktop profile');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')), modules = join(profile, 'node_modules');
const target = join(modules, pkg.name), stage = join(modules, '.ssh-stage-' + randomUUID());
function inside(path) { const rel = relative(modules, path); if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw Error('Install path escapes node_modules'); }
inside(target); inside(stage);
const current = await lstat(target).catch(e => { if (e.code !== 'ENOENT') throw e; });
if (current?.isSymbolicLink()) throw Error('Existing plugin is linked; use the plugin manager to update it');
await mkdir(stage, {recursive: true});
for (const name of pkg.files) await cp(join(root, name), join(stage, name), {recursive: true});
await writeFile(join(stage, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
await mkdir(join(stage, 'node_modules'), {recursive: true});
for (const name of ['ssh2', 'asn1', 'bcrypt-pbkdf', 'tweetnacl', 'safer-buffer']) await cp(join(root, 'node_modules', name), join(stage, 'node_modules', name), {recursive: true});
const backup = join(profile, '.dsh-ssh-install/backups', String(Date.now())); await mkdir(backup, {recursive: true});
await writeFile(join(backup, 'package.json'), original);
manifest.dependencies ??= {}; manifest.dependencies[pkg.name] = 'file:' + root.replaceAll('\\', '/');
if (!manifest.dsh.profile.bundles.includes(pkg.name)) manifest.dsh.profile.bundles.push(pkg.name);
if (current) await rename(target, join(backup, 'plugin'));
try { await rename(stage, target); await atomicWrite(manifestPath, JSON.stringify(manifest, null, 2) + '\n'); }
catch (e) { if (await lstat(target).catch(() => null)) await rename(target, join(backup, 'failed-install')); if (current) await rename(join(backup, 'plugin'), target); await atomicWrite(manifestPath, original); throw e; }
const configSource = option('--config-from', null);
if (configSource) {
  const source = new ConfigStore(resolve(configSource)), destination = new ConfigStore(join(home, 'plugins', pkg.name)); await destination.init();
  const imported = await source.get(), before = await destination.get(), aliases = new Set(before.hosts.map(h => h.alias));
  if (imported.hosts.some(h => aliases.has(h.alias))) throw Error('Host alias already exists; installed plugin but did not overwrite connection configuration');
  parseConfig(before.text + '\n' + imported.text);
  await destination.save(before.text + '\n' + imported.text, before.revision);
  for (const [endpoint, fingerprint] of Object.entries(await source.known())) await destination.pin(endpoint, fingerprint);
  for (const host of imported.hosts) {
    const resultFile = join(resolve(configSource), 'result.json');
    const result = JSON.parse(await readFile(resultFile, 'utf8'));
    if (result.alias === host.alias && result.check?.home) await destination.remember(host.alias, result.check.home);
  }
}
console.log(JSON.stringify({installed: pkg.name, version: pkg.version, profile, target, backup, configurationImported: !!configSource}, null, 2));

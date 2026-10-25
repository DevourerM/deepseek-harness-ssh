import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {root} from './env.mjs';
const destination = join(root, 'dist'); await mkdir(destination, {recursive: true});
const npm = process.env.npm_execpath || join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const packed = JSON.parse(execFileSync(process.execPath, [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', destination], {cwd: root, encoding: 'utf8'}))[0];
const file = join(destination, packed.filename), data = await readFile(file), tar = gunzipSync(data), entries = new Map();
for (let offset = 0; offset + 512 <= tar.length;) {
  const header = tar.subarray(offset, offset + 512); if (header.every(n => n === 0)) break;
  const name = header.subarray(0, 100).toString().replace(/\0.*$/s, ''), size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/s, '').trim(), 8) || 0;
  entries.set(name, tar.subarray(offset + 512, offset + 512 + size)); offset += 512 + Math.ceil(size / 512) * 512;
}
for (const name of ['package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/client.js', 'lib/host/config.js', 'lib/host/ssh.js', 'lib/host/manager.js', 'lib/host/remote.js', 'assets/ssh.svg', 'README.md', 'LICENSE', 'node_modules/ssh2/lib/index.js', 'node_modules/asn1/package.json', 'node_modules/bcrypt-pbkdf/package.json', 'node_modules/tweetnacl/package.json', 'node_modules/safer-buffer/package.json']) assert.ok(entries.has('package/' + name), 'Missing package entry: ' + name);
assert.ok(entries.has('package/lib/host/gateway.js'));
assert.equal(packed.bundled.length, 5, 'SSH protocol dependency tree must be bundled for software/offline installation');
const manifest = JSON.parse(entries.get('package/package.json'));
assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml'); assert.equal(manifest.exports['./client'], './lib/client.js');
assert.equal(manifest.scripts.install, undefined); assert.equal(manifest.scripts.postinstall, undefined);
for (const [name, bytes] of entries) if (name.startsWith('package/lib/')) assert.ok(!/[A-Z]:[\\/](?:code|Users|ai_dev)/.test(bytes.toString()), 'Machine-specific runtime path: ' + name);
assert.ok([...entries.keys()].every(name => !/^package\/(artifacts|research|\.git)\//.test(name)));
await writeFile(join(destination, 'checksums.json'), JSON.stringify({file: packed.filename, version: manifest.version, sha256: createHash('sha256').update(data).digest('hex'), integrity: packed.integrity, bytes: data.length, entries: entries.size, bundled: packed.bundled}, null, 2) + '\n');
console.log('PASS: self-contained standard DSH bundle/client with all pure JS SSH dependencies.\n' + file);

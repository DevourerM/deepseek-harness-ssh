import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, writeFile, readFile, stat, rm} from 'node:fs/promises';
import {join, resolve, relative} from 'node:path';
import {execFileSync} from 'node:child_process';
test('desktop installer preserves existing plugins and profile patches across updates', async t => {
  const root = resolve(import.meta.dirname, '..'), base = join(root, 'artifacts/install-tests'); await mkdir(base, {recursive: true});
  const home = await mkdtemp(join(base, 'home-')), profile = join(home, 'profiles/desktop'); await mkdir(profile, {recursive: true});
  assert.ok(!relative(base, home).startsWith('..')); t.after(() => rm(home, {recursive: true, force: true}));
  const original = {name: 'test-desktop', private: true, dependencies: {'keep-plugin': '1.0.0'}, dsh: {profile: {bundles: ['@deepseek-ai/dsh-base', 'keep-plugin']}}};
  await writeFile(join(profile, 'package.json'), JSON.stringify(original)); const patch = '# keep existing model configuration\n'; await writeFile(join(profile, 'cordis.patch.yml'), patch);
  for (let n = 0; n < 2; n++) execFileSync(process.execPath, [join(root, 'scripts/install-desktop.mjs'), '--home', home], {encoding: 'utf8'});
  const installed = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'));
  assert.equal(installed.dependencies['keep-plugin'], '1.0.0'); assert.equal(installed.dsh.profile.bundles.filter(x => x === 'deepseek-harness-ssh').length, 1);
  assert.ok(installed.dsh.profile.bundles.includes('keep-plugin')); assert.equal(await readFile(join(profile, 'cordis.patch.yml'), 'utf8'), patch);
  assert.ok((await stat(join(profile, 'node_modules/deepseek-harness-ssh/node_modules/ssh2/lib/index.js'))).isFile());
});

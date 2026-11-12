import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, symlink, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const worker = fileURLToPath(new URL('../src/host/file-worker.py', import.meta.url));

function run(query) {
  return new Promise((resolve, reject) => {
    // The remote worker imports POSIX fcntl at load time. Stub it so the same
    // listing code can be checked on Windows without changing the Linux worker.
    const child = spawn('python', ['-c', 'import sys,types,runpy;fcntl=types.ModuleType("fcntl");fcntl.LOCK_EX=2;fcntl.flock=lambda*args,**kwargs:None;sys.modules["fcntl"]=fcntl;runpy.run_path(sys.argv.pop(1),run_name="__main__")', worker], {stdio: ['pipe', 'pipe', 'pipe']});
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code) reject(new Error(stderr || `python exited ${code}`));
      else resolve(JSON.parse(stdout));
    });
    child.stdin.end(JSON.stringify(query));
  });
}

test('sidebar listing keeps a symlink directory under the path the Files UI requested', async () => {
  const root = await mkdtemp(join(process.env.TEMP || tmpdir(), 'ssh-symlink-'));
  try {
    const target = join(root, 'real');
    const linked = join(root, 'runs');
    await mkdir(target);
    await writeFile(join(target, 'train.log'), 'epoch 9\n');
    await mkdir(join(target, 'checkpoints'));
    await writeFile(join(target, 'checkpoints', 'cp9.pth'), 'checkpoint');
    if (process.platform === 'win32') {
      const created = spawn('cmd', ['/c', 'mklink', '/J', linked, target], {stdio: 'ignore'});
      const code = await new Promise(resolve => created.on('close', resolve));
      if (code) throw new Error('cannot create directory junction for symlink regression');
    } else await symlink(target, linked, 'dir');
    const query = {action: 'sidebar', op: 'fs.trees', root, cwd: root, path: root, mode: 'read-only', paths: [linked, join(linked, 'checkpoints')]};
    const result = await run(query);
    assert.equal(result.ok, true);
    const [runs, checkpoints] = result.value.levels;
    assert.equal(runs.path, linked);
    assert.equal(runs.error, undefined);
    assert.deepEqual(runs.entries.map(entry => entry.name).sort(), ['checkpoints', 'train.log']);
    const child = runs.entries.find(entry => entry.name === 'checkpoints');
    assert.equal(child.isDir, true);
    assert.equal(child.path, join(linked, 'checkpoints'));
    assert.equal(checkpoints.path, join(linked, 'checkpoints'));
    assert.deepEqual(checkpoints.entries.map(entry => entry.name), ['cp9.pth']);
    const watched = await run({action: 'sidebar', op: 'fs.watch', root, cwd: root, path: root, mode: 'read-only', paths: [linked]});
    assert.equal(watched.ok, true);
    assert.equal(watched.value.versions[0].path, linked);
    assert.equal(typeof watched.value.versions[0].version, 'string');
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

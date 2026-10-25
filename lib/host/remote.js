// These functions execute on the remote Node runtime. Keep them self-contained.
export const RUNTIME_VERSION = '0.2.1-rc.3';
export async function runtimeInfo(version) {
  const {homedir} = await import('node:os'); const {join} = await import('node:path');
  const {readFile} = await import('node:fs/promises');
  const prefix = join(homedir(), '.dsh-ssh', 'runtime', version);
  let installed = false, installedVersion = null;
  try {
    installedVersion = JSON.parse(await readFile(join(prefix, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8')).version;
    installed = installedVersion === version;
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  console.log('DSH_SSH_JSON:' + JSON.stringify({platform: process.platform, node: process.versions.node, home: homedir(), prefix, installed, installedVersion, requiredVersion: version}));
}
export async function installRuntime(version) {
  const {homedir} = await import('node:os'); const {join} = await import('node:path'); const {mkdir} = await import('node:fs/promises');
  const {spawn} = await import('node:child_process');
  if (!['linux', 'darwin'].includes(process.platform) || Number(process.versions.node.split('.')[0]) < 22) throw Error('需要 Linux/macOS 和 Node >=22');
  const prefix = join(homedir(), '.dsh-ssh', 'runtime', version); await mkdir(prefix, {recursive: true, mode: 0o700});
  const child = spawn('npm', ['install', '--prefix', prefix, '--omit=dev', '--no-audit', '--no-fund', '--save-exact', `@deepseek-ai/dsh@${version}`], {stdio: ['ignore', 'pipe', 'pipe'], detached: true});
  let tail = ''; const consume = data => { tail = (tail + data.toString()).slice(-2000); };
  child.stdout.on('data', consume); child.stderr.on('data', consume);
  const stop = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch {} };
  process.stdin.resume(); process.stdin.once('end', stop); process.once('SIGTERM', stop); process.once('SIGHUP', stop);
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(Error(`npm 安装失败 (${code})：${tail}`))); });
  console.log('DSH_SSH_JSON:' + JSON.stringify({installed: true, version, prefix}));
  process.exit(0);
}
export async function launchHost(version, folder, alias, localPort) {
  const {homedir} = await import('node:os'); const {join, basename} = await import('node:path');
  const {mkdir, writeFile, realpath, stat, readFile, unlink} = await import('node:fs/promises');
  const {unlinkSync, readFileSync} = await import('node:fs');
  const {createHash} = await import('node:crypto'); const {spawn} = await import('node:child_process');
  if (!['linux', 'darwin'].includes(process.platform) || Number(process.versions.node.split('.')[0]) < 22) throw Error('需要 Linux/macOS 和 Node >=22');
  folder = await realpath(folder); if (!(await stat(folder)).isDirectory()) throw Error('工作区必须是现有目录');
  const prefix = join(homedir(), '.dsh-ssh', 'runtime', version), runtime = join(prefix, 'node_modules/@deepseek-ai/dsh');
  if (JSON.parse(await readFile(join(runtime, 'package.json'), 'utf8')).version !== version) throw Error('远端 DSH 版本不兼容，请从设置安装指定运行时');
  const key = createHash('sha256').update(folder).digest('hex').slice(0, 24);
  const home = join(homedir(), '.dsh-ssh', 'workspaces', key), profile = join(home, 'profiles/web');
  await mkdir(profile, {recursive: true, mode: 0o700});
  const lock = join(home, 'host.lock'), owner = `${process.pid}:${Date.now()}`;
  const acquire = () => writeFile(lock, JSON.stringify({pid: process.pid, owner}), {mode: 0o600, flag: 'wx'});
  try { await acquire(); } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const previous = JSON.parse(await readFile(lock, 'utf8'));
    if (!Number.isSafeInteger(previous.pid) || previous.pid < 1) throw Error('远端 Host 锁损坏，请检查 ' + lock);
    try { process.kill(previous.pid, 0); throw Error('此目录已有受管 DSH Host，请先断开旧连接后重试'); }
    catch (e) { if (e.code !== 'ESRCH') throw e; }
    await unlink(lock); await acquire();
  }
  process.on('exit', () => { try { if (JSON.parse(readFileSync(lock, 'utf8')).owner === owner) unlinkSync(lock); } catch {} });
  const seed = join(profile, 'ssh-workspace.mjs');
  await writeFile(seed, `export const inject=['workspaceRegistry'];\nexport async function apply(ctx){await ctx.workspaceRegistry.create(${JSON.stringify(folder)},${JSON.stringify(basename(folder) + ' [SSH ' + alias + ']')});}\n`, {mode: 0o600});
  const initialize = async (file, content) => { try { await writeFile(file, content, {mode: 0o600, flag: 'wx'}); } catch (e) { if (e.code !== 'EEXIST') throw e; } };
  await initialize(join(profile, 'package.json'), JSON.stringify({name: 'dsh-ssh-workspace', private: true, dsh: {profile: {bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']}}}));
  await initialize(join(profile, 'cordis.patch.yml'), '- insert:\n    - id: ssh-workspace-seed\n      name: ' + JSON.stringify(seed) + '\n');
  // One execution world for the complete native DSH interface. No local credentials are copied.
  const child = spawn(process.execPath, [join(runtime, 'lib/bin.js'), '--profile', 'web', '--host', '127.0.0.1', '--port', '0', '--trusted-host', `127.0.0.1:${localPort}`, '--no-open'], {
    cwd: folder, env: {...process.env, DSH_HOME: home}, stdio: ['ignore', 'inherit', 'inherit'], detached: true
  });
  let stopping = false;
  const stop = () => {
    if (stopping) return; stopping = true;
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} process.exit(0); }, 3000);
  };
  process.stdin.resume(); process.stdin.once('end', stop); process.once('SIGTERM', stop); process.once('SIGHUP', stop);
  child.once('error', error => { console.error(error.message); process.exit(1); });
  child.once('exit', () => stop());
}

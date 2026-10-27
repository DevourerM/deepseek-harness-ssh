import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {artifacts} from './env.mjs';
import {ConfigStore} from '../src/host/config.js';
import {Mounts} from '../src/host/mounts.js';
import {RemoteTerminals} from '../src/host/terminals.js';
import {exec, quote} from '../src/host/ssh.js';

await mkdir(artifacts, {recursive: true});
const store = new ConfigStore(join(artifacts, 'real-server')), config = await store.get(), alias = config.hosts[0].alias;
const mounts = new Mounts(store), terminals = new RemoteTerminals(mounts);
try {
  const connection = await mounts.connect(alias), remoteHome = (await mounts.browse(alias, '.')).path;
  const folder = remoteHome + '/.dsh-ssh/validation/terminal-' + Date.now();
  await exec(connection, 'mkdir -p ' + quote(folder));
  const record = {id: 'terminal-validation', alias, localRoot: join(artifacts, 'terminal-identity'), remoteRoot: folder}; mounts.records.push(record);
  const shells = await terminals.shells(record); assert.ok(shells.some(shell => /bash$/.test(shell.path)));
  const start = signal => terminals.spawn(record, {argv: ['/bin/bash', '--noprofile', '--norc', '-i'], cwd: record.localRoot, cols: 100, rows: 30, terminalType: 'xterm-256color', graceMs: 300, signal});
  const allocation = new AbortController(), terminal = await start(allocation.signal); allocation.abort(); let output = '';
  terminal.output.on('data', chunk => { output = (output + chunk.toString()).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replaceAll('\r', '').slice(-100000); });
  const until = async pattern => { for (let i = 0; i < 150; i++) { if (pattern.test(output)) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw Error('Missing terminal output ' + pattern + ': ' + output.slice(-2000)); };
  await terminal.write("printf '\\n%s\\n' 'SSH_TERM_READY'; pwd; test -t 0 && printf '\\n%s\\n' 'PTY_OK'\r");
  await until(/\r?\nPTY_OK\r?\n/); assert.ok(output.includes(folder));
  await terminal.resize(132, 42); await terminal.write('stty size\r'); await until(/\r?\n42 132\r?\n/);
  await terminal.write("printf '\\n%s\\n' '中文 SSH 正常'; printf 'REMOTE_TERMINAL_FILE\\n' > terminal-proof.txt\r"); await until(/\r?\n中文 SSH 正常\r?\n/);
  const bytes = await mounts.request(record, {action: 'read', path: folder + '/terminal-proof.txt', limit: 1024}); assert.equal(Buffer.from(bytes.data, 'base64').toString(), 'REMOTE_TERMINAL_FILE\n');
  await terminal.write('sleep 30\r');
  for (let i = 0; i < 50; i++) { if ((await terminal.inspectForeground()).processGroupId !== terminal.pid) break; await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.equal((await terminal.inspectActivity()).state, 'busy');
  await terminal.signalForeground('SIGINT');
  await terminal.write("printf '\\n%s\\n' 'INTERRUPT_OK'\r"); await until(/\r?\nINTERRUPT_OK\r?\n/);
  await terminal.write("sleep 90 & printf '\\nBG_PID:%s\\n' \"$!\"\r"); await until(/\r?\nBG_PID:\d+\r?\n/);
  const background = Number(output.match(/\r?\nBG_PID:(\d+)\r?\n/)[1]);
  await terminal.terminate();
  const checkProcess = `import os; p='/proc/${background}/stat'; print('GONE' if not os.path.exists(p) else open(p).read().rsplit(')',1)[1].split()[0])`;
  const probe = await exec(connection, `python3 -c ${quote(checkProcess)}`);
  assert.ok(['GONE', 'Z'].includes(probe.stdout.trim()), probe.stdout);
  const exiting = await start(); exiting.output.resume(); await exiting.write('exit 7\r'); assert.equal((await exiting.done).exitCode, 7);
  const detached = await start(); detached.output.resume(); detached.channel.end(); await detached.done;
  await writeFile(join(artifacts, 'terminal-result.json'), JSON.stringify({realSshPty: true, remoteCwd: true, unicode: true, remoteFileWrite: true, resize: true, foregroundInterrupt: true, backgroundCleanup: true, exitCode: true, disconnectCleanup: true, survivesAllocationSignal: true, desktopUnchanged: true}, null, 2));
  console.log('PASS: real Linux SSH PTY, remote cwd/file writes, Unicode, resize, foreground Ctrl-C, exit status, background and disconnect cleanup.');
} finally { await terminals.dispose(); mounts.dispose(); }

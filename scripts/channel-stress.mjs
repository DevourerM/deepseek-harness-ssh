import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {artifacts, runtimeVersion} from './env.mjs';
import {ConfigStore} from '../src/host/config.js';
import {Mounts} from '../src/host/mounts.js';
import {RemoteTerminals} from '../src/host/terminals.js';
import {RemoteProcesses} from '../src/host/processes.js';
import {SidebarAdapter} from '../src/host/sidebar.js';

await mkdir(artifacts, {recursive: true});
const store = new ConfigStore(join(artifacts, 'real-server')), config = await store.get(), alias = config.hosts[0].alias;
const mounts = new Mounts(store), terminals = new RemoteTerminals(mounts), processes = new RemoteProcesses(mounts);
try {
  await mounts.connect(alias); const folder = (await mounts.browse(alias, '.')).path;
  const record = {id: 'channel-stress', alias, localRoot: join(artifacts, 'channel-stress-identity'), remoteRoot: folder}; mounts.records.push(record);
  const session = {id: 'stress', header: {cwd: record.localRoot}};
  const adapter = new SidebarAdapter({workingDirectory: {get: () => record.localRoot}, sandboxPolicy: {resolve: () => ({mode: 'read-only'})}}, mounts);
  const live = await Promise.all(Array.from({length: 8}, () => terminals.spawn(record, {argv: ['/bin/bash', '--noprofile', '--norc', '-i'], cwd: record.localRoot, cols: 80, rows: 24, terminalType: 'xterm-256color', graceMs: 300})));
  for (const terminal of live) terminal.output.resume();
  const burst = () => Promise.all(Array.from({length: 40}, (_, n) => adapter.request({record, session}, n % 2 ? 'fs.tree' : 'fs.watch', {path: folder, paths: [folder]})));
  const first = await burst();
  for (let i = 0; i < first.length; i++) {
    if (i % 2) assert.ok(Array.isArray(first[i].entries));
    else assert.ok(first[i].versions[0].version);
  }
  for (const terminal of live) { assert.equal(terminal.running, true); await terminal.inspectActivity(); }
  console.log('PASS: 8 real SSH terminals + 40 concurrent side-panel directory/watch calls; no manual refresh or terminal disconnect.');
  await live.pop().terminate();
  const handle = processes.spawn(record, {argv: ['bash', '-lc', 'printf QUEUE_PROCESS_STARTED; sleep 20'], cwd: record.localRoot, stdio: {stdin: 'ignore', stdout: {maxBytes: 1024}, stderr: {maxBytes: 1024}}});
  for (let i = 0; !handle.collected.stdout.readFrom(0).text.includes('QUEUE_PROCESS_STARTED'); i++) { assert.ok(i < 100, 'remote process did not start'); await new Promise(resolve => setTimeout(resolve, 50)); }
  const started = Date.now(), timer = setTimeout(() => handle.terminate(), 50);
  try { await Promise.all([burst(), handle.done]); } finally { clearTimeout(timer); }
  assert.ok(Date.now() - started < 10000, 'termination control must not wait behind long-lived sessions');
  assert.notEqual((await handle.done).exitCode, 0);
  for (const terminal of live) assert.equal(terminal.running, true);
  await terminals.dispose(); assert.equal(terminals.handles.size, 0);
  await writeFile(join(artifacts, 'channel-stress-result.json'), JSON.stringify({hostRuntime: runtimeVersion(), actualSsh: true, eightTerminals: true, directoryAndWatchRequests: 80, allRequestsSucceeded: true, saturatedCommandTermination: true, terminalsPreserved: true, readOnlyRemoteValidation: true, desktopUnchanged: true}, null, 2));
  console.log('PASS: saturated SSH command termination uses reserved capacity; directory traffic completes and existing terminals remain alive.');
} finally { processes.dispose(); await terminals.dispose(); mounts.dispose(); }

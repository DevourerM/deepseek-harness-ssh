import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ConfigStore, SshError} from '../src/host/config.js';
import {LocalManager} from '../src/host/local-manager.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ssh-workspace-config-'));
  const store = new ConfigStore(root); await store.init();
  const config = await store.get();
  await store.save('Host old\n HostName old.example\n User tester\nHost next twin\n HostName next.example\n User tester\n', config.revision);
  const workspaces = new Map(), byPath = new Map(), calls = [], sessions = new Map(), hooks = new Map(), services = new Map();
  const registry = {
    get: id => workspaces.get(id),
    async create(path, title) {
      calls.push(['create', path]);
      if (byPath.has(path)) return byPath.get(path);
      const workspace = {id: 'workspace-' + workspaces.size, title, sessionIds: [], async setTitle(value) {calls.push(['title', value]); this.title = value;}};
      Object.defineProperty(workspace, 'path', {get: () => path});
      workspaces.set(workspace.id, workspace); byPath.set(path, workspace); return workspace;
    }
  };
  const ctx = {workspaceRegistry: registry, sessions: {get: id => sessions.get(id), async flush(session) {calls.push(['flush', session.id]); return true;}}, workingDirectory: {get: session => session.cwd},
    async waterfall(name, input, next) {calls.push([name, input.sessionId]); return next();}, get: name => services.get(name),
    on(name, fn, options) {const list = hooks.get(name) || []; options?.prepend ? list.unshift(fn) : list.push(fn); hooks.set(name, list); return () => list.splice(list.indexOf(fn), 1);}};
  const manager = new LocalManager(store, ctx); t.after(() => manager.dispose()); await manager.init();
  manager.mounts.browse = async (alias, path, secrets, signal) => {
    calls.push(['browse', alias, path, secrets]); signal?.throwIfAborted(); await store.host(alias);
    return {path: path === '~/project' ? '/canonical/project' : path, directories: []};
  };
  const opened = await manager.open('old', '/original', {}, undefined, 'Original');
  const record = manager.mounts.records[0], workspace = workspaces.get(opened.workspaceId);
  workspace.sessionIds.push('conversation-1'); calls.length = 0;
  const invoke = (name, args, next = () => Promise.resolve()) => (hooks.get(name) || []).reduceRight((tail, hook) => () => hook(...args, tail), next)();
  return {root, store, manager, workspace, record, workspaces, registry, calls, ctx, sessions, services, invoke};
}
const inputFor = async (f, fields = {}) => ({...await f.manager.config(f.workspace.id), ...fields});
const diskRecords = async f => JSON.parse(await readFile(join(f.root, 'mounts.json'), 'utf8'));
const failedWrite = async () => {throw Object.assign(Error('disk full'), {code: 'ENOSPC'});};
const tick = () => new Promise(resolve => setImmediate(resolve));
function sessionFor(f, id = 'conversation-1', cwd = '/original/changed') {
  const events = [], session = {id, header: Object.freeze({cwd: f.record.localRoot}), cwd,
    append(type, data) {events.push({type, data}); this.cwd = data.cwd;}, snapshotEvents: () => [...events]};
  return {session, events};
}

// The public entity exposes path through a getter so accidental identity
// mutation fails exactly as with the real WorkspaceEntity.
test('workspace-config exposes local and remote fields with title/config revisions', async t => {
  const f = await fixture(t), first = await f.manager.config(f.workspace.id);
  assert.deepEqual({...first, revision: undefined}, {workspaceId: f.workspace.id, kind: 'remote', title: 'Original', path: '/original', alias: 'old', revision: undefined});
  await f.workspace.setTitle('Native rename');
  const renamed = await f.manager.config(f.workspace.id); assert.notEqual(renamed.revision, first.revision);
  const config = await f.store.get(); await f.store.save(config.text + '# external config change\n', config.revision);
  assert.notEqual((await f.manager.config(f.workspace.id)).revision, renamed.revision);
  const local = await f.registry.create(join(f.root, 'local'), 'Local');
  assert.deepEqual({...await f.manager.config(local.id), revision: undefined}, {workspaceId: local.id, kind: 'local', title: 'Local', path: local.path, alias: '', revision: undefined});
  await assert.rejects(() => f.manager.config('missing'), {code: 'WORKSPACE_MISSING'});
});

test('remote edit canonicalizes target and preserves identities, references, and conversations', async t => {
  const f = await fixture(t), identities = {id: f.record.id, localRoot: f.record.localRoot, workspaceId: f.record.workspaceId};
  const oldPath = f.workspace.path, oldSessionIds = f.workspace.sessionIds;
  const result = await f.manager.updateWorkspace(await inputFor(f, {alias: 'next', path: '~/project', title: 'Renamed', secrets: {next: {password: 'temporary-password'}}}));
  assert.deepEqual({...result, revision: undefined}, {workspaceId: f.workspace.id, kind: 'remote', title: 'Renamed', path: '/canonical/project', alias: 'next', revision: undefined});
  assert.equal(f.manager.mounts.records[0], f.record);
  for (const [key, value] of Object.entries(identities)) assert.equal(f.record[key], value);
  assert.equal(f.workspace.path, oldPath); assert.equal(f.workspace.sessionIds, oldSessionIds);
  assert.deepEqual(oldSessionIds, ['conversation-1']); assert.equal(f.calls.filter(c => c[0] === 'create').length, 0);
  assert.deepEqual(await diskRecords(f), [f.record]);
  assert.equal((await readFile(join(f.root, 'mounts.json'), 'utf8')).includes('temporary-password'), false);
  assert.equal(f.manager.mounts.route('test.txt', f.record.localRoot).path, '/canonical/project/test.txt');
});

test('local updates change title and enforce readonly path and alias', async t => {
  const f = await fixture(t), local = await f.registry.create(join(f.root, 'local'), 'Local');
  const current = await f.manager.config(local.id), result = await f.manager.updateWorkspace({...current, title: 'Local renamed'});
  assert.equal(result.title, 'Local renamed'); assert.equal(result.path, current.path);
  assert.deepEqual(local.sessionIds, []); assert.equal(f.calls.some(c => c[0] === 'browse'), false);
  await assert.rejects(() => f.manager.updateWorkspace({...result, title: 'Invalid path', path: join(f.root, 'elsewhere')}), {code: 'PATH_READONLY'});
  await assert.rejects(() => f.manager.updateWorkspace({...result, title: 'Invalid alias', alias: 'next'}), {code: 'PATH_READONLY'});
  assert.equal(local.title, 'Local renamed');
});

test('stale revisions and revisions changed during SSH validation cannot persist', async t => {
  const f = await fixture(t), input = await inputFor(f, {alias: 'next', path: '/next', title: 'New'});
  await f.workspace.setTitle('External rename');
  await assert.rejects(() => f.manager.updateWorkspace(input), {code: 'WORKSPACE_CONFLICT'});
  assert.equal(f.calls.some(c => c[0] === 'browse'), false);
  const fresh = await inputFor(f, {alias: 'next', path: '/next', title: 'New'}), browse = f.manager.mounts.browse;
  f.manager.mounts.browse = async (...args) => {const value = await browse(...args); const config = await f.store.get(); await f.store.save(config.text + '# changed during validation\n', config.revision); return value;};
  await assert.rejects(() => f.manager.updateWorkspace(fresh), {code: 'WORKSPACE_CONFLICT'});
  assert.equal(f.record.alias, 'old'); assert.equal(f.workspace.title, 'External rename');
  assert.equal((await diskRecords(f))[0].remoteRoot, '/original');
});

test('all public activity families block target edits while offline title edits work', async t => {
  const f = await fixture(t);
  for (const kind of ['turn', 'jobs', 'subagents', 'schedules']) {
    f.ctx.waterfall = async (name, input) => {assert.equal(name, 'workspace/session-activity'); assert.equal(input.sessionId, 'conversation-1'); return [{kind, items: ['running']}];};
    const update = await inputFor(f, {alias: 'next', path: '/next', title: 'New'});
    await assert.rejects(() => f.manager.updateWorkspace(update), error => error.code === 'WORKSPACE_ACTIVE' && error.details.activity[0].kind === kind);
  }
  f.manager.mounts.browse = async () => {throw Error('offline');};
  const titleOnly = await f.manager.updateWorkspace(await inputFor(f, {title: 'Title during activity'}));
  assert.equal(titleOnly.title, 'Title during activity'); assert.equal(f.record.remoteRoot, '/original');
});

test('activity appearing during browse and retained terminals block retargeting', async t => {
  const f = await fixture(t), browse = f.manager.mounts.browse; let active = false;
  f.ctx.waterfall = async () => active ? [{kind: 'turn', items: ['new turn']}] : [];
  f.manager.mounts.browse = async (...args) => {const result = await browse(...args); active = true; return result;};
  const update = await inputFor(f, {path: '/new', title: 'New'});
  await assert.rejects(() => f.manager.updateWorkspace(update), {code: 'WORKSPACE_ACTIVE'});
  active = false; f.manager.mounts.browse = browse;
  f.services.set('terminalController', {list: id => {assert.equal(id, 'conversation-1'); return [{id: 'terminal', state: 'running'}];}});
  await assert.rejects(() => f.manager.updateWorkspace(update), error => error.code === 'WORKSPACE_ACTIVE' && error.details.activity[0].kind === 'terminals');
  assert.equal(f.record.remoteRoot, '/original'); assert.equal(f.workspace.title, 'Original');
});

test('duplicate endpoints across aliases and invalid SSH targets leave all state unchanged', async t => {
  const f = await fixture(t);
  await f.manager.open('next', '/mapped', {});
  const update = await inputFor(f, {alias: 'twin', path: '/mapped', title: 'Duplicate'});
  await assert.rejects(() => f.manager.updateWorkspace(update), {code: 'WORKSPACE_DUPLICATE'});
  for (const code of ['NOT_DIRECTORY', 'SSH_AUTH_FAILED', 'HOST_KEY_UNKNOWN', 'PATH_INVALID']) {
    f.manager.mounts.browse = async () => {throw new SshError('validation failed', code);};
    await assert.rejects(() => f.manager.updateWorkspace({...update, path: '/unavailable'}), {code});
    assert.equal(f.workspace.title, 'Original'); assert.equal(f.record.alias, 'old');
    assert.equal((await diskRecords(f))[0].remoteRoot, '/original');
  }
});

test('mount persistence failure rolls back title and retains record and disk snapshots', async t => {
  const f = await fixture(t), before = {...f.record}, disk = await diskRecords(f);
  f.manager.mounts.persist = failedWrite;
  const update = await inputFor(f, {alias: 'next', path: '/new', title: 'Uncommitted'});
  await assert.rejects(() => f.manager.updateWorkspace(update), {code: 'ENOSPC'});
  assert.deepEqual(f.record, before); assert.deepEqual(await diskRecords(f), disk); assert.equal(f.workspace.title, 'Original');
});

test('title-write failures and cancellation after title write roll back coherently', async t => {
  const f = await fixture(t), setTitle = f.workspace.setTitle.bind(f.workspace), update = await inputFor(f, {title: 'New'});
  f.workspace.setTitle = async value => {await setTitle(value); if (value === 'New') throw Object.assign(Error('title unavailable'), {code: 'TITLE_WRITE'});};
  await assert.rejects(() => f.manager.updateWorkspace(update), {code: 'TITLE_WRITE'});
  assert.equal(f.workspace.title, 'Original'); assert.equal(f.record.title, 'Original');
  const controller = new AbortController();
  f.workspace.setTitle = async value => {await setTitle(value); if (value === 'New') controller.abort(new SshError('cancelled', 'CANCELLED'));};
  await assert.rejects(() => f.manager.updateWorkspace(update, controller.signal), {code: 'CANCELLED'});
  assert.equal(f.workspace.title, 'Original'); assert.equal((await diskRecords(f))[0].title, 'Original');
});

test('rollback failure reports explicit partial-recovery error', async t => {
  const f = await fixture(t), setTitle = f.workspace.setTitle.bind(f.workspace);
  f.manager.mounts.persist = failedWrite;
  f.workspace.setTitle = async value => {if (value === 'Original') throw Object.assign(Error('rollback unavailable'), {code: 'TITLE_WRITE'}); await setTitle(value);};
  const update = await inputFor(f, {title: 'New'});
  await assert.rejects(() => f.manager.updateWorkspace(update), error => error.code === 'WORKSPACE_ROLLBACK_FAILED' && error.details.operation === 'ENOSPC' && error.details.rollback === 'TITLE_WRITE');
  assert.equal(f.record.title, 'Original'); assert.equal((await diskRecords(f))[0].title, 'Original');
});

test('concurrent edits serialize and reject the second stale revision', async t => {
  const f = await fixture(t), entered = Promise.withResolvers(), release = Promise.withResolvers(), browse = f.manager.mounts.browse;
  f.manager.mounts.browse = async (...args) => {entered.resolve(); await release.promise; return browse(...args);};
  const input = await inputFor(f, {path: '/first', title: 'First'}), first = f.manager.updateWorkspace(input);
  await entered.promise;
  const second = f.manager.updateWorkspace({...input, path: '/second', title: 'Second'}), rejected = assert.rejects(second, {code: 'WORKSPACE_CONFLICT'});
  release.resolve(); await first; await rejected;
  assert.equal(f.record.remoteRoot, '/first'); assert.equal(f.workspace.title, 'First');
  assert.equal(f.calls.filter(call => call[0] === 'browse').length, 1);
});

test('opening the original target after edit allocates fresh identities and conversations', async t => {
  const f = await fixture(t), identity = {...f.record};
  await f.manager.updateWorkspace(await inputFor(f, {alias: 'next', path: '/new', title: 'Edited'}));
  const opened = await f.manager.open('old', '/original', {});
  assert.notEqual(opened.id, identity.id); assert.notEqual(opened.localRoot, identity.localRoot); assert.notEqual(opened.workspaceId, identity.workspaceId);
  assert.match(opened.id, /^[\da-f]{8}-[\da-f-]{27}$/);
  assert.deepEqual(f.workspaces.get(opened.workspaceId).sessionIds, []); assert.deepEqual(f.workspace.sessionIds, ['conversation-1']);
  assert.equal(f.record.id, identity.id); assert.equal(f.record.workspaceId, identity.workspaceId);
});

test('existing open and legacy rename use rollback and preserve native titles on re-open', async t => {
  const f = await fixture(t), before = {...f.record}, persist = f.manager.mounts.persist.bind(f.manager.mounts);
  f.manager.mounts.persist = failedWrite;
  await assert.rejects(() => f.manager.open('old', '/original', {}, undefined, 'Uncommitted'), {code: 'ENOSPC'});
  assert.equal(f.workspace.title, 'Original'); assert.deepEqual(f.record, before);
  await assert.rejects(() => f.manager.rename(f.record.localRoot, 'Legacy'), {code: 'ENOSPC'});
  assert.equal(f.workspace.title, 'Original'); assert.deepEqual(f.record, before);
  f.manager.mounts.persist = persist; await f.workspace.setTitle('Native title');
  await f.manager.open('old', '/original', {}); assert.equal(f.workspace.title, 'Native title');
});

test('retarget cwd reset survives restart, updates public projection, and retains later cd', async t => {
  const f = await fixture(t), {session, events} = sessionFor(f);
  await f.manager.updateWorkspace(await inputFor(f, {alias: 'next', path: '/new', title: 'New'}));
  assert.deepEqual((await diskRecords(f))[0].cwdResetSessions, ['conversation-1']);
  assert.equal(f.ctx.workingDirectory.get(session), f.record.localRoot);
  f.manager.dispose();
  const restored = new LocalManager(f.store, f.ctx); t.after(() => restored.dispose()); await restored.init();
  assert.equal(f.ctx.workingDirectory.get(session), restored.mounts.records[0].localRoot);
  await f.invoke('system-prompt/assemble', [{}, {agent: {session}}], async () => {
    assert.equal(f.ctx.workingDirectory.get(session), session.header.cwd);
    assert.equal(session.cwd, session.header.cwd);
  });
  assert.deepEqual(events, [{type: 'working-directory/change', data: {cwd: session.header.cwd}}]);
  assert.deepEqual((await diskRecords(f))[0].cwdResetSessions, []);
  session.append('working-directory/change', {cwd: '/new/subdir'});
  await f.invoke('agent/pre-step', [{agent: {session}}]);
  assert.equal(f.ctx.workingDirectory.get(session), '/new/subdir'); assert.equal(events.length, 2);
});

test('failed cwd reset persists pending admission and retries before model context', async t => {
  const f = await fixture(t), {session, events} = sessionFor(f);
  await f.manager.updateWorkspace(await inputFor(f, {path: '/new', title: 'New'}));
  const persist = f.manager.mounts.persist.bind(f.manager.mounts); f.manager.mounts.persist = failedWrite;
  let contextBuilt = false;
  await assert.rejects(() => f.invoke('system-prompt/assemble', [{}, {agent: {session}}], () => {contextBuilt = true;}), {code: 'ENOSPC'});
  assert.equal(contextBuilt, false); assert.deepEqual(f.record.cwdResetSessions, ['conversation-1']);
  assert.deepEqual((await diskRecords(f))[0].cwdResetSessions, ['conversation-1']);
  f.manager.mounts.persist = persist;
  await f.invoke('agent/pre-step', [{agent: {session}}]);
  assert.deepEqual(f.record.cwdResetSessions, []); assert.equal(events.length, 2);
  session.append('working-directory/change', {cwd: '/new/later'});
  await f.invoke('tools/pre-execute', [{agent: {session}}]); assert.equal(session.cwd, '/new/later');
});

test('cwd marker removal waits for session flush durability before model context', async t => {
  const f = await fixture(t), {session, events} = sessionFor(f), entered = Promise.withResolvers(), release = Promise.withResolvers();
  await f.manager.updateWorkspace(await inputFor(f, {path: '/new', title: 'New'}));
  let durableEvents = [], contextBuilt = false;
  f.ctx.sessions.flush = async () => {entered.resolve(); await release.promise; durableEvents = structuredClone(events); return true;};
  const reset = f.invoke('system-prompt/assemble', [{}, {agent: {session}}], () => {contextBuilt = true;});
  await entered.promise;
  assert.equal(contextBuilt, false); assert.deepEqual(durableEvents, []);
  assert.deepEqual((await diskRecords(f))[0].cwdResetSessions, ['conversation-1']);
  release.resolve(); await reset;
  assert.equal(contextBuilt, true); assert.equal(durableEvents[0].data.cwd, f.record.localRoot);
  assert.deepEqual((await diskRecords(f))[0].cwdResetSessions, []);
});

test('missing or failed session flush retains cwd markers for retry', async t => {
  const f = await fixture(t), {session} = sessionFor(f);
  await f.manager.updateWorkspace(await inputFor(f, {path: '/new', title: 'New'}));
  let contextBuilt = false;
  const cases = [
    {flush: undefined, code: 'WORKSPACE_CWD_PENDING'},
    {flush: async () => false, code: 'WORKSPACE_CWD_PENDING'},
    {flush: async () => {throw Object.assign(Error('flush failed'), {code: 'SESSION_WRITE'});}, code: 'SESSION_WRITE'}
  ];
  for (const {flush, code} of cases) {
    f.ctx.sessions.flush = flush;
    await assert.rejects(() => f.invoke('agent/pre-step', [{agent: {session}}], () => {contextBuilt = true;}), {code});
    assert.equal(contextBuilt, false); assert.deepEqual(f.record.cwdResetSessions, ['conversation-1']);
    assert.deepEqual((await diskRecords(f))[0].cwdResetSessions, ['conversation-1']);
  }
  f.ctx.sessions.flush = async () => true;
  await f.invoke('agent/pre-step', [{agent: {session}}]);
  assert.deepEqual((await diskRecords(f))[0].cwdResetSessions, []);
});

test('asynchronous update jobs return result and structured errors through polling', async t => {
  const f = await fixture(t), input = await inputFor(f, {title: 'Job title'});
  const {jobId} = f.manager.job('update-workspace', input);
  assert.equal(f.manager.poll(jobId).done, false);
  await tick(); await f.manager.mounts.tail; await tick();
  const done = f.manager.poll(jobId); assert.equal(done.done, true); assert.equal(done.result.title, 'Job title'); assert.equal(done.error, undefined);
  const stale = f.manager.job('update-workspace', input);
  await tick(); await f.manager.mounts.tail; await tick();
  assert.equal(f.manager.poll(stale.jobId).error.code, 'WORKSPACE_CONFLICT');
});

test('model work entering during a target commit waits for mapping and cwd recovery', async t => {
  const f = await fixture(t), {session} = sessionFor(f), entered = Promise.withResolvers(), release = Promise.withResolvers();
  const setTitle = f.workspace.setTitle.bind(f.workspace);
  f.workspace.setTitle = async title => {entered.resolve(); await release.promise; await setTitle(title);};
  const update = f.manager.updateWorkspace(await inputFor(f, {alias: 'next', path: '/new', title: 'New'}));
  await entered.promise;
  let modelStarted = false;
  const model = f.invoke('agent/pre-step', [{agent: {session}}], () => {
    modelStarted = true;
    assert.equal(f.record.alias, 'next'); assert.equal(f.record.remoteRoot, '/new');
    assert.equal(f.ctx.workingDirectory.get(session), f.record.localRoot);
  });
  await tick(); assert.equal(modelStarted, false); assert.equal(f.record.remoteRoot, '/original');
  release.resolve(); await update; await model;
  assert.equal(modelStarted, true); assert.deepEqual((await diskRecords(f))[0].cwdResetSessions, []);
});

test('invalid workspace edits fail before SSH validation or persistence', async t => {
  const f = await fixture(t), input = await inputFor(f);
  await assert.rejects(() => f.manager.updateWorkspace({}), {code: 'WORKSPACE_MISSING'});
  await assert.rejects(() => f.manager.updateWorkspace({...input, revision: ''}), {code: 'WORKSPACE_CONFLICT'});
  for (const fields of [{title: ''}, {title: 'x'.repeat(121)}, {alias: ''}, {path: ''}, {secrets: []}]) {
    await assert.rejects(() => f.manager.updateWorkspace({...input, ...fields}), {code: 'REQUEST_INVALID'});
  }
  assert.equal(f.calls.some(call => call[0] === 'browse'), false);
  assert.equal(f.workspace.title, 'Original'); assert.equal(f.record.remoteRoot, '/original');
});

test('open waits for target edits and persists both records without lost updates', async t => {
  const f = await fixture(t), entered = Promise.withResolvers(), release = Promise.withResolvers(), browse = f.manager.mounts.browse;
  f.manager.mounts.browse = async (...args) => {if (args[1] === '/edited') {entered.resolve(); await release.promise;} return browse(...args);};
  const update = f.manager.updateWorkspace(await inputFor(f, {path: '/edited', title: 'Edited'}));
  await entered.promise;
  const open = f.manager.open('old', '/original', {});
  await tick(); assert.equal(f.calls.filter(call => call[0] === 'browse').length, 0);
  release.resolve(); await update; const opened = await open;
  assert.equal(f.manager.mounts.records.length, 2); assert.equal((await diskRecords(f)).length, 2);
  assert.equal(f.record.remoteRoot, '/edited'); assert.notEqual(opened.workspaceId, f.record.workspaceId);
});

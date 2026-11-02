import test from 'node:test';
import assert from 'node:assert/strict';
import {join, win32} from 'node:path';
import {tmpdir} from 'node:os';
import {Mounts} from '../src/host/mounts.js';
import {installSubagentAdapter} from '../src/host/subagents.js';

function fixture() {
  const mounts = new Mounts({});
  const record = {id: 'one', localRoot: join(tmpdir(), 'ssh-child-one'), remoteRoot: '/srv/项目 空格'};
  const other = {id: 'two', localRoot: join(tmpdir(), 'ssh-child-two'), remoteRoot: '/srv/two'};
  mounts.records = [record, other];
  const parent = {session: {header: {cwd: record.localRoot}}};
  const calls = [], cleanup = [];
  const ctx = {
    workingDirectory: {
      get: session => session.current || session.header.cwd,
      ensure: async agent => mounts.scope.run(mounts.forAgent(agent), () => mounts.route('', agent.session.current || agent.session.header.cwd).path),
      set: async (agent, path) => { await Promise.resolve(); agent.session.current = mounts.route(path, agent.session.header.cwd)?.path || path; return agent.session.current; },
    },
    subagents: {async startActivation(spec) {
      calls.push(spec);
      // Reproduce the real host's Windows cwd resolution, even on Linux CI.
      const cwd = spec.request.cwd !== undefined && win32.isAbsolute(spec.request.cwd)
        ? spec.request.cwd : win32.resolve(await ctx.workingDirectory.ensure(spec.request.parent), spec.request.cwd ?? '.');
      const child = {session: {header: {...spec.request.parent.session.header}}};
      await ctx.workingDirectory.set(child, cwd);
      return {child, cwd};
    }},
    inject: (_names, fn) => fn({...ctx, effect: effect => cleanup.push(effect())}),
  };
  const original = ctx.subagents.startActivation, originalSet = ctx.workingDirectory.set;
  const undo = installSubagentAdapter(ctx, mounts);
  return {mounts, record, other, parent, calls, ctx, original, originalSet, undo, cleanup,
    start: (cwd, selected = parent) => ctx.subagents.startActivation({provider: 'spawn', delivery: 'parent', signal: new AbortController().signal, request: {parent: selected, ...(cwd === undefined ? {} : {cwd})}})};
}

test('Windows native delegation receives POSIX cwd for default, relative, explicit and nested children', async () => {
  const f = fixture();
  assert.match(win32.resolve(f.record.remoteRoot, '.'), /^[a-z]:/i);
  const initial = await f.start();
  assert.equal(initial.cwd, f.record.remoteRoot);
  assert.equal(initial.child.session.current, f.record.remoteRoot);
  f.parent.session.current = '/srv/项目 空格/sub';
  assert.equal((await f.start()).cwd, '/srv/项目 空格/sub');
  assert.equal((await f.start('../child 中文')).cwd, '/srv/项目 空格/child 中文');
  const explicit = await f.start('/srv/项目 空格/absolute');
  assert.equal(explicit.cwd, '/srv/项目 空格/absolute');
  assert.equal((await f.start('nested', explicit.child)).cwd, '/srv/项目 空格/absolute/nested');
  assert.equal((await f.start(join(f.record.localRoot, 'mapped'))).cwd, '/srv/项目 空格/mapped');
  assert.equal(f.calls[0].delivery, 'parent');
  assert.equal(f.mounts.scope.getStore(), undefined);
  f.undo();
});

test('delegation rejects actual Windows/local and foreign identity paths before native child startup', async () => {
  const f = fixture();
  for (const path of ['C:\\Users\\private\\file', '\\\\host\\share', f.other.localRoot]) {
    await assert.rejects(() => f.start(path), {code: 'FS_SANDBOX_DENIED'});
  }
  assert.equal(f.calls.length, 0);
  const control = new AbortController(); control.abort();
  await assert.rejects(() => f.ctx.subagents.startActivation({request: {parent: f.parent, cwd: '/srv/项目 空格'}, signal: control.signal}), {name: 'AbortError'});
  assert.equal(f.calls.length, 0);
  f.undo();
});

test('remote child setup is scoped independently of tools and leaves local delegation and unload unchanged', async () => {
  const f = fixture(), local = {session: {header: {cwd: tmpdir()}}};
  const [a, b] = await Promise.all([
    f.ctx.workingDirectory.set(f.parent, '/srv/项目 空格/sub'),
    f.ctx.workingDirectory.set({session: {header: {cwd: f.other.localRoot}}}, '/srv/two/sub'),
  ]);
  assert.equal(a, '/srv/项目 空格/sub'); assert.equal(b, '/srv/two/sub');
  const localSpec = {request: {parent: local, cwd: 'C:\\local'}, provider: 'spawn'};
  await f.ctx.subagents.startActivation(localSpec);
  assert.equal(f.calls.at(-1), localSpec);
  for (const cleanup of f.cleanup) cleanup();
  assert.equal(f.ctx.subagents.startActivation, f.original);
  f.undo();
  assert.equal(f.ctx.workingDirectory.set, f.originalSet);
});

test('remote delegation reaches native ownership admission before yielding and does not leak parent tool scope', async () => {
  const f = fixture();
  f.ctx.workingDirectory.ensure = () => { throw Error('Must not yield before native admission'); };
  let childPreStepStore = 'unset';
  const originalStart = f.ctx.subagents.startActivation;
  f.undo();
  f.ctx.subagents.startActivation = async spec => {
    childPreStepStore = f.mounts.scope.getStore();
    return originalStart(spec);
  };
  const undo2 = installSubagentAdapter(f.ctx, f.mounts);
  const pending = f.mounts.scope.run(f.record, () => f.start('child'));
  assert.equal(f.calls.length, 1, 'native admission must acquire its ownership hold synchronously');
  assert.equal(childPreStepStore, undefined, 'child activation must not inherit parent tool scope');
  assert.equal((await pending).cwd, f.record.remoteRoot + '/child');
  undo2();
});

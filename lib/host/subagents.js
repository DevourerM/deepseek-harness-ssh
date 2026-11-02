import {SshError} from './config.js';

// Native delegation resolves relative cwd with node:path. On Windows this turns
// a remote /srv/project into D:\srv\project before workingDirectory.set runs.
// Resolve at the public delegation boundary so the host receives an absolute
// POSIX cwd and can keep its original admission, lineage and permission checks.
export function installSubagentAdapter(ctx, mounts) {
  const restore = [];
  const patch = (owner, name, factory) => {
    const descriptor = Object.getOwnPropertyDescriptor(owner, name);
    const original = owner[name].bind(owner), replacement = factory(original);
    owner[name] = replacement;
    const undo = () => {
      if (Object.getOwnPropertyDescriptor(owner, name)?.value !== replacement) return;
      if (descriptor) Object.defineProperty(owner, name, descriptor);
      else delete owner[name];
    };
    restore.push(undo);
    return undo;
  };

  // Child setup happens before agent/created and outside tool dispatch. Its
  // inherited identity directory selects the remote connection even then.
  patch(ctx.workingDirectory, 'set', original => (agent, path, signal) => {
    const record = mounts.forAgent(agent);
    return record ? mounts.scope.run(record, () => original(agent, path, signal)) : original(agent, path, signal);
  });

  ctx.inject(['subagents'], scope => {
    const undo = patch(scope.subagents, 'startActivation', original => async spec => {
      const {request} = spec, record = mounts.forAgent(request.parent);
      if (!record) return original(spec);
      // Do not await before native admission: it acquires the parent's ownership
      // hold, which keeps a finishing parent alive during child initialization.
      // Native workingDirectory.set still validates the child's canonical cwd.
      const current = ctx.workingDirectory.get(request.parent.session);
      const route = mounts.scope.run(record, () => mounts.route(request.cwd ?? '', current));
      if (!route || route.record.id !== record.id) throw new SshError('子智能体的目录必须属于当前 SSH 连接', 'FS_SANDBOX_DENIED');
      spec.signal?.throwIfAborted();
      // Exit any enclosing tool scope so the spawned child's turn loop does not
      // inherit the parent tool's AsyncLocalStorage store during preStep.
      return mounts.scope.run(undefined, () => original({...spec, request: {...request, cwd: route.path}}));
    });
    scope.effect(() => undo);
  });
  return () => { for (const undo of restore.reverse()) undo(); };
}

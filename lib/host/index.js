import {homedir} from 'node:os';
import {join} from 'node:path';
import {ConfigStore, SshError} from './config.js';
import {publicError} from './jobs.js';
import {LocalManager} from './local-manager.js';
import {installLocalAdapter} from './processes.js';
import {installSidebarAdapter} from './sidebar.js';

export const inject = ['connection', 'workspaceRegistry', 'fs', 'subprocess', 'tools', 'workingDirectory', 'systemPrompt', 'sessions', 'agents', 'sandboxPolicy'];
export async function apply(ctx) {
  const store = new ConfigStore(join(process.env.DSH_HOME?.trim() || join(homedir(), '.dsh'), 'plugins', 'deepseek-harness-ssh'));
  await store.init(); const manager = new LocalManager(store, ctx); await manager.init();
  const removeAdapter = await installLocalAdapter(ctx, manager.mounts);
  installSidebarAdapter(ctx, manager.mounts);
  ctx.effect(() => removeAdapter);
  ctx.effect(() => () => manager.dispose());
  ctx.effect(() => ctx.connection.fetch.register({path: '/api/dsh-ssh', methods: ['POST'], requestBody: 'buffered', fetch: async request => {
    try {
      const raw = await request.text();
      if (Buffer.byteLength(raw) > 160 * 1024) throw new SshError('请求过大', 'REQUEST_LIMIT', undefined, 413);
      let input; try { input = JSON.parse(raw); } catch { throw new SshError('无效 JSON', 'REQUEST_INVALID'); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SshError('无效请求', 'REQUEST_INVALID');
      let result;
      switch (input.action) {
        case 'config': result = await store.get(); break;
        case 'save': result = await store.save(input.text, input.revision); break;
        case 'trust': await manager.ssh.trust(input.challengeId); result = {trusted: true}; break;
        case 'known': result = await store.known(); break;
        case 'forget': await store.forget(input.endpoint); result = {removed: true}; break;
        case 'check': case 'browse': case 'install': case 'open': case 'connect':
          if (typeof input.alias !== 'string') throw new SshError('请选择 SSH 主机', 'HOST_MISSING');
          if (input.secrets !== undefined && (!input.secrets || typeof input.secrets !== 'object' || Array.isArray(input.secrets))) throw new SshError('凭据格式无效', 'REQUEST_INVALID');
          result = manager.job(input.action, input); break;
        case 'poll': result = manager.poll(input.jobId); break;
        case 'cancel': result = manager.cancel(input.jobId); break;
        case 'sessions': result = manager.list(); break;
        case 'auth-state': result = manager.mounts.authState(); break;
        case 'auth-cancel': result = manager.mounts.cancelAuth(input.id); break;
        case 'bookmarks': result = await store.bookmarks(); break;
        case 'session': result = manager.get(input.id); break;
        case 'disconnect': result = manager.disconnect(input.id); break;
        default: throw new SshError('未知 SSH 操作', 'ACTION_INVALID');
      }
      return Response.json(result, {headers: {'Cache-Control': 'no-store'}});
    } catch (error) {
      // Never log request bodies, passwords, private keys or launch URLs.
      return Response.json({error: publicError(error)}, {status: error.status || 400, headers: {'Cache-Control': 'no-store'}});
    }
  }}), 'dsh-ssh: authenticated plugin API');
}

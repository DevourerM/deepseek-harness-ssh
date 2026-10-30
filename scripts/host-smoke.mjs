import assert from 'node:assert/strict';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {root, artifacts, runtimeVersion} from './env.mjs';
import {prepareHome, startHost, authenticated} from './host-fixture.mjs';

await mkdir(artifacts, {recursive: true}); const home = await mkdtemp(join(artifacts, 'host-'));
await prepareHome(home); const host = await startHost(home);
const hostVersion = runtimeVersion();
try {
  assert.ok(!/incompatible|skipping profile bundle/i.test(host.log), 'Host must load the plugin bundle on DSH ' + hostVersion + ':\n' + host.log);
  const auth = await authenticated(host.url);
  const unauthenticated = await fetch(auth.origin + '/api/dsh-ssh', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{"action":"config"}'});
  assert.ok([401, 403].includes(unauthenticated.status), 'API must inherit native authentication');
  const initial = await auth.api({action: 'config'}); assert.equal(initial.status, 200); assert.deepEqual(initial.data.hosts, []);
  const save = await auth.api({action: 'save', text: 'Host integration\n HostName 127.0.0.1\n User test\n', revision: initial.data.revision});
  assert.equal(save.status, 200); assert.equal(save.data.hosts[0].alias, 'integration');
  assert.equal((await auth.api({action: 'save', text: 'Host stale', revision: initial.data.revision})).status, 409);
  assert.equal((await auth.api({action: 'save', text: 'Host x\n ProxyCommand evil', revision: save.data.revision})).data.error.code, 'CONFIG_INVALID');
  assert.equal((await auth.api({action: 'session', id: 'missing'})).data.error.code, 'SESSION_MISSING');
  assert.equal((await auth.api({action: 'trust', challengeId: 'made-up'})).data.error.code, 'TRUST_EXPIRED');
  assert.deepEqual((await auth.api({action: 'sessions'})).data, []);
  const result = {host: hostVersion, authenticatedApi: true, configSave: true, revisionConflict: true, invalidConfigRejected: true, unauthorizedRejected: true};
  await writeFile(join(artifacts, 'host-result.json'), JSON.stringify(result, null, 2));
  console.log('PASS: real DSH ' + hostVersion + ' Host loads plugin (no incompatible/skipping warning); native API authentication, settings save, revision conflict and validation.');
} catch (e) { console.error(host.log); throw e; }
finally { await host.stop(); }

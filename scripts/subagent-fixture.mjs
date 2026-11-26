// Runs only in an isolated test profile: deterministic local model, real native
// child lifecycle and file tools, no user model or desktop session involved.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {runtimePath} from './env.mjs';
const {LlmAdapter} = await import(pathToFileURL(join(runtimePath(), '@deepseek-ai/dsh-llm/lib/index.js')).href);
const text = value => ({type: 'text', text: value});
const failures = events => JSON.stringify(events.filter(event =>
  event.type === 'turn/end' || event.type === 'tool/result' && event.data.message?.isError).slice(-8));
const finished = (events, marker) => events.some(event => event.type === 'assistant/message'
  && event.data.message.content.some(block => block.type === 'text' && block.text === marker));
const completed = new Set();

class Adapter extends LlmAdapter {
  async listModels() { return [{provider: 'ssh-subagent-fixture', id: 'test', name: 'SSH child test', context: {contextWindow: 100000}}]; }
  async *stream(options) {
    const index = options.messages.findLastIndex(message => message.role === 'user' && /SSH_(?:CHILD_CASE|TEAM_LEAD)::/.test(JSON.stringify(message.content)));
    if (index < 0) { yield {type: 'text-delta', index: 0, text: 'PARENT_IDLE'}; yield {type: 'finish', reason: {kind: 'stop'}}; return; }
    const [, kind, tag] = JSON.stringify(options.messages[index].content).match(/SSH_(CHILD_CASE|TEAM_LEAD)::([a-z-]+)/);
    const results = options.messages.slice(index + 1).filter(message => message.role === 'tool');
    const hasTool = name => options.tools.some(tool => tool.name === name);
    assert.ok(hasTool('ssh_exec') && !hasTool('pwsh') && !hasTool('bash'));
    assert.ok(!results.some(message => message.isError), 'SSH tool failure: ' + JSON.stringify(results));
    const calls = kind === 'TEAM_LEAD' ? [
      ...(hasTool('team_task_create') ? [['team_task_create', {subject: 'SSH Team regression', description: 'Check the SSH working directory'}]] : []),
      ['subagent', {description: 'Spawn SSH teammate', prompt: 'SSH_CHILD_CASE::team-' + tag + '-spawn'}],
      ['subagent_fork', {description: 'Fork SSH teammate', prompt: 'SSH_CHILD_CASE::team-' + tag + '-fork'}],
      ...(hasTool('team_task_list') ? [['team_task_list', {}]] : []),
    ] : [
      ['write', {file_path: tag + '.txt', content: 'SSH_CHILD_REMOTE_OK ' + tag + '\n'}],
      ['read', {file_path: tag + '.txt'}],
      ...(!tag.startsWith('team-') ? [] : [
        ['glob', {pattern: tag + '.txt'}],
        ['grep', {pattern: 'SSH_CHILD_REMOTE_OK', include: tag + '.txt'}],
      ]),
    ];
    const next = calls[results.length];
    if (next) {
      const [name, args] = next;
      yield {type: 'tool-call-delta', index: 0, id: tag + '-' + results.length, name, argumentsDelta: JSON.stringify(args)};
      yield {type: 'finish', reason: {kind: 'tool-calls'}};
    } else {
      if (kind === 'CHILD_CASE') {
        assert.ok(JSON.stringify(results[1]).includes('SSH_CHILD_REMOTE_OK ' + tag));
        if (tag.startsWith('team-')) {
          assert.ok(JSON.stringify(results[2]).includes('/' + tag + '.txt'), JSON.stringify(results[2]));
          assert.ok(JSON.stringify(results[3]).includes('SSH_CHILD_REMOTE_OK ' + tag), JSON.stringify(results[3]));
        }
        completed.add(tag);
      }
      yield {type: 'text-delta', index: 0, text: 'SSH_' + kind + '_FINISHED::' + tag};
      yield {type: 'finish', reason: {kind: 'stop'}};
    }
  }
}
export const inject = ['llm', 'agents', 'subagents', 'connection', 'workingDirectory', 'tools', 'agentPresets'];
export async function apply(ctx) {
  ctx.llm.registerAdapter(['ssh-subagent-fixture'], new Adapter());
  ctx.effect(() => ctx.connection.fetch.register({path: '/api/ssh-child-test', methods: ['POST'], requestBody: 'buffered', fetch: async request => {
    try {
      const {id, root, action, tag} = await request.json();
      const parent = ctx.agents.get(id); assert.ok(parent, 'Expected the native session to be resident');
      const teams = ctx.get('agentTeams');
      if (action === 'prepare') {
        await ctx.workingDirectory.set(parent, root + '/sub', request.signal);
        await teams?.setEnabled(parent, true, request.signal);
        return Response.json({teamMode: teams?.isEnabled(parent) ?? false});
      }
      if (action === 'status') {
        // Delivery from a finishing teammate can wake the lead again.
        do {
          await delay(100, undefined, {signal: request.signal});
          await parent.whenIdle();
          await ctx.subagents.waitForTreeWork?.(parent);
          await ctx.subagents.waitForChildren?.(parent);
        } while ((await ctx.waterfall('workspace/session-activity', {sessionId: id}, async () => [])).length);
        const events = parent.session.snapshotEvents();
        assert.ok(finished(events, 'SSH_TEAM_LEAD_FINISHED::' + tag), failures(events));
        for (const provider of ['spawn', 'fork']) {
          const childTag = 'team-' + tag + '-' + provider;
          const children = ctx.agents.list().filter(agent => agent !== parent);
          assert.ok(completed.has(childTag), 'Teammate must complete remote read and search: ' + childTag + ' ' + children.map(child => failures(child.session.snapshotEvents())).join('\n'));
        }
        return Response.json({
          cwd: ctx.workingDirectory.get(parent.session),
          reset: events.some(event => event.type === 'workspace-root/change' && event.data.cwd === parent.session.header.cwd),
          teamTask: teams?.listTasks(parent).some(task => task.subject === 'SSH Team regression') ?? false,
        });
      }
      const start = (provider, label, fields) => ctx.subagents.startActivation({
        provider, label, delivery: 'caller', signal: request.signal,
        ...(typeof ctx.subagents.rootOf === 'function' ? fields : {request: fields}),
      });
      const results = [];
      const run = async (owner, tag, cwd, provider = 'spawn', during) => {
        const activation = await start(provider, tag, {parent: owner, prompt: [text('SSH_CHILD_CASE::' + tag)], maxDepth: 4, ...(cwd === undefined ? {} : {cwd})});
        try {
          const child = ctx.agents.get(activation.childId); assert.ok(child);
          if (during) await during(child);
          await child.whenIdle();
          const events = child.session.snapshotEvents();
          assert.ok(finished(events, 'SSH_CHILD_CASE_FINISHED::' + tag), failures(events));
          results.push({tag, provider, cwd: ctx.workingDirectory.get(child.session), headerCwd: child.session.header.cwd});
        } finally { await activation.dispose(); }
      };
      await run(parent, 'default', undefined, 'spawn', child => run(child, 'nested', 'nested'));
      await ctx.workingDirectory.set(parent, root + '/sub', request.signal);
      await run(parent, 'changed');
      await Promise.all([
        run(parent, 'relative', '../relative'),
        run(parent, 'absolute', root + '/absolute'),
        run(parent, 'mapped', join(parent.session.header.cwd, 'mapped')),
        run(parent, 'fork', root + '/fork', 'fork'),
      ]);
      await assert.rejects(() => start('spawn', 'invalid', {parent, cwd: 'C:\\Users\\not-remote', prompt: [text('must fail')]}), {code: 'FS_SANDBOX_DENIED'});
      return Response.json({results, localPathBlocked: true});
    } catch (error) { return Response.json({error: error.stack}, {status: 500}); }
  }}));
}

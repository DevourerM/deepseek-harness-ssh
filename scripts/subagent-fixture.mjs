// Runs only in an isolated test profile: deterministic local model, real native
// child lifecycle and file tools, no user model or desktop session involved.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runtimePath} from './env.mjs';
const {LlmAdapter} = await import(pathToFileURL(join(runtimePath(), '@deepseek-ai/dsh-llm/lib/index.js')).href);

class Adapter extends LlmAdapter {
  async listModels() { return [{provider: 'ssh-subagent-fixture', id: 'test', name: 'SSH child test', context: {contextWindow: 100000}}]; }
  async *stream(options) {
    const index = options.messages.findLastIndex(message => message.role === 'user' && JSON.stringify(message).includes('SSH_CHILD_CASE::'));
    if (index < 0) { yield {type: 'text-delta', index: 0, text: 'PARENT_IDLE'}; yield {type: 'finish', reason: {kind: 'stop'}}; return; }
    const tag = JSON.stringify(options.messages[index]).match(/SSH_CHILD_CASE::([a-z-]+)/)[1];
    const results = options.messages.slice(index + 1).filter(message => message.role === 'tool');
    if (!options.tools.some(tool => tool.name === 'ssh_exec') || options.tools.some(tool => tool.name === 'pwsh')) throw Error('SSH child tools were not installed');
    if (results.some(message => message.isError)) throw Error('Child tool failure: ' + JSON.stringify(results));
    const calls = [
      ['write', {file_path: tag + '.txt', content: 'SSH_CHILD_REMOTE_OK ' + tag + '\n'}],
      ['read', {file_path: tag + '.txt'}],
    ];
    if (results.length < calls.length) {
      const [name, args] = calls[results.length];
      yield {type: 'tool-call-delta', index: 0, id: tag + '-' + results.length, name, argumentsDelta: JSON.stringify(args)};
      yield {type: 'finish', reason: {kind: 'tool-calls'}};
    } else {
      assert.ok(JSON.stringify(results).includes('SSH_CHILD_REMOTE_OK ' + tag));
      yield {type: 'text-delta', index: 0, text: 'SSH_CHILD_FINISHED::' + tag};
      yield {type: 'finish', reason: {kind: 'stop'}};
    }
  }
}
export const inject = ['llm', 'agents', 'subagents', 'connection', 'workingDirectory', 'tools', 'agentPresets'];
export async function apply(ctx) {
  ctx.llm.registerAdapter(['ssh-subagent-fixture'], new Adapter());
  ctx.effect(() => ctx.connection.fetch.register({path: '/api/ssh-child-test', methods: ['POST'], requestBody: 'buffered', fetch: async request => {
    let parentHandle;
    try {
      const {id} = await request.json();
      const records = JSON.parse(await readFile(join(process.env.DSH_HOME, 'plugins/deepseek-harness-ssh/mounts.json'), 'utf8'));
      const record = records.find(record => record.id === id); assert.ok(record);
      const preset = await ctx.agentPresets.resolve();
      parentHandle = await ctx.agents.create({sessionId: randomUUID(), meta: {cwd: record.localRoot, agentPreset: preset.id}, agentOptions: {provider: 'ssh-subagent-fixture', model: 'test'}, setup: async childCtx => { await ctx.agentPresets.mount(childCtx, preset.id); }});
      const parent = parentHandle.agent, results = [];
      const run = async (owner, tag, cwd, provider = 'spawn', during) => {
        const activation = await ctx.subagents.startActivation({provider, label: tag, delivery: 'caller', signal: request.signal,
          request: {parent: owner, prompt: [{type: 'text', text: 'SSH_CHILD_CASE::' + tag}], maxDepth: 4, ...(cwd === undefined ? {} : {cwd})}});
        const child = ctx.agents.get(activation.childId); assert.ok(child);
        if (during) await during(child);
        await child.whenIdle();
        const events = JSON.stringify(child.session.snapshotEvents());
        assert.ok(events.includes('SSH_CHILD_FINISHED::' + tag), events.slice(-6000));
        results.push({tag, provider, cwd: ctx.workingDirectory.get(child.session), headerCwd: child.session.header.cwd});
        return child;
      };
      await run(parent, 'default', undefined, 'spawn', child => run(child, 'nested', 'nested'));
      await ctx.workingDirectory.set(parent, record.remoteRoot + '/sub', request.signal);
      await run(parent, 'changed');
      await run(parent, 'relative', '../relative');
      await run(parent, 'absolute', record.remoteRoot + '/absolute');
      await run(parent, 'mapped', join(record.localRoot, 'mapped'));
      await run(parent, 'fork', record.remoteRoot + '/fork', 'fork');
      await assert.rejects(() => ctx.subagents.startActivation({provider: 'spawn', delivery: 'caller', signal: request.signal,
        request: {parent, cwd: 'C:\\Users\\not-remote', prompt: [{type: 'text', text: 'must fail'}]}}), {code: 'FS_SANDBOX_DENIED'});
      return Response.json({results, localPathBlocked: true});
    } catch (error) { return Response.json({error: error.stack}, {status: 500}); }
    finally { await parentHandle?.dispose(); }
  }}));
}

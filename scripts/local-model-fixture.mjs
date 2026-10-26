// Isolated local model: proves native tools run remotely without an API account.
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {runtimePath} from './env.mjs';
const {LlmAdapter} = await import(pathToFileURL(join(runtimePath(), '@deepseek-ai/dsh-llm/lib/index.js')).href);
export const inject = ['llm'];
class Adapter extends LlmAdapter {
  async listModels() { return [{provider: 'ssh-local-fixture', id: 'test', name: 'Local SSH validation', context: {contextWindow: 100000}}]; }
  async *stream(options) {
    await writeFile(join(process.env.DSH_HOME, 'model-input.json'), JSON.stringify(options, null, 2));
    if (!options.tools.some(t => t.name === 'ssh_exec')) {
      yield {type: 'text-delta', index: 0, text: 'FAILED: remote tool missing; refusing any file mutation'};
      yield {type: 'finish', reason: {kind: 'stop'}}; return;
    }
    const messages = options.messages.filter(m => m.role === 'tool');
    const calls = [
      ['write', {file_path: 'local-model-proof.txt', content: 'LOCAL_DSH_REMOTE_FILE_V1\n'}],
      ['read', {file_path: 'local-model-proof.txt'}],
      ['edit', {file_path: 'local-model-proof.txt', old_string: 'V1', new_string: 'V2'}],
      ['glob', {pattern: '**/*proof.txt'}],
      ['grep', {pattern: 'LOCAL_DSH_REMOTE_FILE_V2', include: '*.txt'}],
      ['ssh_exec', {command: 'pwd; cat local-model-proof.txt', timeout_ms: 15000}],
    ];
    if (messages.length < calls.length) {
      const [name, args] = calls[messages.length];
      yield {type: 'tool-call-delta', index: 0, id: 'local-ssh-' + messages.length, name, argumentsDelta: JSON.stringify(args)};
      yield {type: 'finish', reason: {kind: 'tool-calls'}};
    } else {
      const failed = messages.some(m => m.isError || /\[exit code: [1-9]/.test(JSON.stringify(m)));
      yield {type: 'text-delta', index: 0, text: failed ? 'LOCAL_SSH_FAILED ' + JSON.stringify(messages) : 'LOCAL_MODEL_REMOTE_TOOLS_OK'};
      yield {type: 'finish', reason: {kind: 'stop'}};
    }
  }
}
export async function apply(ctx) { ctx.llm.registerAdapter(['ssh-local-fixture'], new Adapter()); }

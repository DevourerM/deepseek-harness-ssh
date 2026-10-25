// Only loaded by the isolated integration fixture. No external model requests.
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {runtimePath} from './env.mjs';
const {LlmAdapter} = await import(pathToFileURL(join(runtimePath(), '@deepseek-ai/dsh-llm/lib/index.js')).href);
export const inject = ['llm'];
class FixtureAdapter extends LlmAdapter {
  async listModels() { return [{provider: 'ssh-fixture', id: 'test', name: 'SSH local test model', context: {contextWindow: 100000}}]; }
  async *stream(options) {
    if (options.messages.at(-1)?.role !== 'tool') {
      yield {type: 'tool-call-delta', index: 0, id: 'ssh-fixture-read', name: 'read', argumentsDelta: JSON.stringify({file_path: 'remote-proof.txt'})};
      yield {type: 'finish', reason: {kind: 'tool-calls'}};
    } else {
      const content = JSON.stringify(options.messages.at(-1));
      yield {type: 'text-delta', index: 0, text: content.includes('DSH SSH remote file preview verification') ? 'SSH_NATIVE_TOOL_READ_OK' : 'SSH_NATIVE_TOOL_READ_FAILED: ' + content};
      yield {type: 'finish', reason: {kind: 'stop'}};
    }
  }
}
export async function apply(ctx) {
  ctx.llm.registerAdapter(['ssh-fixture'], new FixtureAdapter());
}

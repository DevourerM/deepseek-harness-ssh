import {existsSync} from 'node:fs';
import {resolve, join} from 'node:path';
export const root = resolve(import.meta.dirname, '..');
export const artifacts = join(root, 'artifacts');
export function runtimePath() {
  const runtime = [process.env.DSH_DEV_RUNTIME, resolve(root, '../tree-chat/research/compat-0.2.1-rc.3/dsh/node_modules')].find(p => p && existsSync(join(p, '@deepseek-ai/dsh/lib/bin.js')));
  if (!runtime) throw Error('设置 DSH_DEV_RUNTIME 为合法 DSH 0.2.1-rc.3 运行时的 node_modules 目录后再执行集成测试。');
  return resolve(runtime);
}

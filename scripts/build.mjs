import {mkdir, readFile, writeFile, cp} from 'node:fs/promises';
import {join, resolve} from 'node:path';
const root = resolve(import.meta.dirname, '..');
await mkdir(join(root, 'lib'), {recursive: true});
await cp(join(root, 'src/host'), join(root, 'lib/host'), {recursive: true});
await writeFile(join(root, 'lib/index.js'), "export {apply, inject} from './host/index.js';\n");
const client = await readFile(join(root, 'src/client/index.js'), 'utf8'), css = await readFile(join(root, 'src/client/style.css'), 'utf8');
await writeFile(join(root, 'lib/client.js'), `window.__ModuleLoader__.load({id:'deepseek-harness-ssh',factory:(require)=>{\nconst React=require('react');\nconst CSS=${JSON.stringify(css)};\n${client}\nreturn {apply,inject};\n}});\n`);
console.log('Built DSH SSH host and client plugin.');

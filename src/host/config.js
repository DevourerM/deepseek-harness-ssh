import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, writeFile, unlink} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {homedir, userInfo} from 'node:os';

export const DEFAULT_CONFIG = `# DSH SSH 独立配置；不会读取或修改 VS Code / ~/.ssh/config。
# 首次连接需要核对并信任主机 SHA256 指纹。
# Host my-server
#   HostName 192.168.1.20
#   User developer
#   Port 22
#   IdentityFile ~/.ssh/id_ed25519
#   # 或使用 IdentityAgent default；密码与密钥口令在界面临时输入。
#   # ProxyJump bastion
#   # NodePath /usr/local/bin/node
#   # ConnectTimeout 15
`;
export class SshError extends Error {
  constructor(message, code = 'SSH_ERROR', details, status = 400) {
    super(message); this.code = code; this.details = details; this.status = status;
  }
}
const directives = new Set(['hostname', 'user', 'port', 'identityfile', 'identityagent', 'proxyjump', 'connecttimeout', 'serveraliveinterval', 'nodepath']);
function words(line, number) {
  const result = []; let word = '', quote = null, active = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) { if (c === quote) quote = null; else word += c; }
    else if (c === '"' || c === "'") { quote = c; active = true; }
    else if (c === '#') break;
    else if (/\s/.test(c)) { if (active) { result.push(word); word = ''; active = false; } }
    else { word += c; active = true; }
  }
  if (quote) throw new SshError(`第 ${number} 行引号未闭合`, 'CONFIG_INVALID');
  if (active) result.push(word);
  return result;
}
function valueCheck(value, name) {
  if (!value || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) throw new SshError(`${name} 包含无效字符`, 'CONFIG_INVALID');
  return value;
}
export function parseConfig(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 128 * 1024) throw new SshError('配置最大 128 KiB', 'CONFIG_INVALID');
  const blocks = []; let current;
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    const tokens = words(line, i + 1); if (!tokens.length) continue;
    // OpenSSH also permits Key=Value and Key = Value.
    const match = tokens[0].match(/^([^=]+)=(.*)$/);
    if (match) tokens.splice(0, 1, match[1], ...(match[2] ? [match[2]] : []));
    if (tokens[1] === '=') tokens.splice(1, 1);
    const key = tokens.shift().toLowerCase();
    if (key === 'host') {
      if (!tokens.length || tokens.some(t => t !== '*' && !/^[a-zA-Z0-9_-]{1,80}$/.test(t))) throw new SshError(`第 ${i + 1} 行：Host 使用字母、数字、下划线或短横线；仅支持 * 默认块`, 'CONFIG_INVALID');
      current = {aliases: tokens, options: {}}; blocks.push(current); continue;
    }
    if (!directives.has(key)) throw new SshError(`第 ${i + 1} 行：不支持 ${key}；不执行 Include / ProxyCommand / LocalCommand`, 'CONFIG_INVALID');
    if (!current || tokens.length !== 1) throw new SshError(`第 ${i + 1} 行：指令须位于 Host 块内，并有一个值（含空格时加引号）`, 'CONFIG_INVALID');
    current.options[key] ??= valueCheck(tokens[0], key);
  }
  const aliases = [...new Set(blocks.flatMap(b => b.aliases).filter(a => a !== '*'))];
  if (aliases.length > 100) throw new SshError('最多配置 100 台主机', 'CONFIG_INVALID');
  const hosts = aliases.map(alias => {
    const o = {};
    for (const b of blocks) if (b.aliases.includes(alias) || b.aliases.includes('*')) for (const [k, v] of Object.entries(b.options)) o[k] ??= v;
    const hostname = o.hostname || alias;
    if (!/^[a-zA-Z0-9_.:%-]+$/.test(hostname) || hostname.startsWith('-')) throw new SshError(`${alias}: HostName 必须是主机名、IPv4 或不带方括号的 IPv6`, 'CONFIG_INVALID');
    const integer = (key, fallback, min, max) => {
      const raw = o[key] ?? String(fallback); const n = Number(raw);
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n < min || n > max) throw new SshError(`${alias}: ${key} 必须介于 ${min} 与 ${max}`, 'CONFIG_INVALID');
      return n;
    };
    const host = {alias, hostname, username: o.user || userInfo().username, port: integer('port', 22, 1, 65535),
      identityFile: o.identityfile, identityAgent: o.identityagent ?? (o.identityfile ? 'none' : 'default'),
      proxyJump: o.proxyjump === 'none' ? undefined : o.proxyjump,
      timeout: integer('connecttimeout', 15, 1, 120) * 1000,
      keepalive: integer('serveraliveinterval', 15, 1, 300) * 1000, nodePath: o.nodepath || 'node'};
    valueCheck(host.username, 'User'); return host;
  });
  const map = new Map(hosts.map(h => [h.alias, h]));
  for (const host of hosts) {
    const seen = new Set([host.alias]); let h = host;
    while (h.proxyJump) {
      if (seen.has(h.proxyJump) || seen.size >= 5) throw new SshError(`${host.alias}: ProxyJump 循环或层数超过 4`, 'CONFIG_INVALID');
      seen.add(h.proxyJump); h = map.get(h.proxyJump);
      if (!h) throw new SshError(`${host.alias}: 跳板机必须引用已配置的 Host`, 'CONFIG_INVALID');
    }
  }
  return hosts;
}
export function localPath(path) {
  return path === '~' ? homedir() : /^~[\\/]/.test(path) ? join(homedir(), path.slice(2)) : resolve(path);
}
export const revisionOf = text => createHash('sha256').update(text).digest('hex');
export async function atomicWrite(path, content) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temp, content, {mode: 0o600, flag: 'wx'}); await rename(temp, path); }
  finally { await unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
export class ConfigStore {
  tail = Promise.resolve();
  constructor(root) { this.root = root; this.path = join(root, 'config'); this.knownPath = join(root, 'known-hosts.json'); }
  serial(fn) { const result = this.tail.then(fn); this.tail = result.catch(() => {}); return result; }
  async init() { await mkdir(this.root, {recursive: true, mode: 0o700}); }
  async get() {
    let text; try { text = await readFile(this.path, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; text = DEFAULT_CONFIG; }
    return {text, revision: revisionOf(text), hosts: parseConfig(text), path: this.path};
  }
  save(text, revision) { return this.serial(async () => {
    parseConfig(text);
    if (revision !== (await this.get()).revision) throw new SshError('配置已被其他窗口修改，请重新加载', 'CONFIG_CONFLICT', undefined, 409);
    await atomicWrite(this.path, text); return this.get();
  }); }
  async host(alias) { const host = (await this.get()).hosts.find(h => h.alias === alias); if (!host) throw new SshError('找不到 SSH 主机，请先保存配置', 'HOST_MISSING'); return host; }
  async known() { try { return JSON.parse(await readFile(this.knownPath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; return {}; } }
  pin(endpoint, fingerprint) { return this.serial(async () => {
    const known = await this.known();
    if (known[endpoint] && known[endpoint] !== fingerprint) throw new SshError('主机指纹已改变；请核实服务器后手动移除旧指纹', 'HOST_KEY_CHANGED');
    known[endpoint] = fingerprint; await atomicWrite(this.knownPath, JSON.stringify(known, null, 2) + '\n');
  }); }
  forget(endpoint) { return this.serial(async () => { const known = await this.known(); delete known[endpoint]; await atomicWrite(this.knownPath, JSON.stringify(known, null, 2) + '\n'); }); }
  async bookmarks() { try { return JSON.parse(await readFile(join(this.root, 'workspaces.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; return []; } }
  remember(alias, path) { return this.serial(async () => {
    const entries = (await this.bookmarks()).filter(e => e.alias !== alias || e.path !== path);
    entries.unshift({alias, path, openedAt: new Date().toISOString()});
    await atomicWrite(join(this.root, 'workspaces.json'), JSON.stringify(entries.slice(0, 100), null, 2) + '\n');
  }); }
}

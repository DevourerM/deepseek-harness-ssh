window.__ModuleLoader__.load({id:'deepseek-harness-ssh',factory:(require)=>{
const React=require('react');
const CSS=".ds-ssh-settings,.ds-ssh-dialog,.ds-ssh-remote{color:var(--dsw-alias-label-primary,#20242c);font:14px/1.55 system-ui,sans-serif}\n.ds-ssh-settings{box-sizing:border-box;width:100%;min-width:0;max-width:820px;padding:12px 24px 32px;overflow-wrap:anywhere}.ds-ssh-settings h2,.ds-ssh-dialog h2{font-size:20px;font-weight:600;margin:0 0 8px}.ds-ssh-settings h3{font-size:15px;margin:0 0 10px}.ds-ssh-settings p,.ds-ssh-dialog p{margin:8px 0}.ds-ssh-muted{color:var(--dsw-alias-label-secondary,#727784);font-size:13px}\n.ds-ssh-card{padding:20px 0;border-bottom:1px solid var(--dsw-alias-border-l3,#d6dae1)}.ds-ssh-row{display:flex;align-items:center;flex-wrap:wrap;gap:10px}.ds-ssh-row h2{flex:1}.ds-ssh-stack{display:flex;flex-direction:column;gap:12px}.ds-ssh-field{display:flex;flex:1;flex-direction:column;gap:6px;min-width:130px;margin:8px 0}.ds-ssh-field input,.ds-ssh-field select,.ds-ssh-settings select{box-sizing:border-box;width:100%;height:38px;border:1px solid var(--dsw-alias-border-l3,#c5cbd5);border-radius:8px;background:var(--dsw-alias-bg-base,#fff);color:inherit;padding:6px 10px;font:inherit}\n.ds-ssh-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:34px;padding:6px 12px;border:1px solid var(--dsw-alias-border-l3,#c5cbd5);border-radius:8px;background:var(--dsw-alias-bg-base,#fff);color:inherit;font:inherit;cursor:pointer}.ds-ssh-button:hover:enabled{background:var(--dsw-alias-interactive-bg-hover,#edf1f7)}.ds-ssh-button:disabled{opacity:.5;cursor:default}.ds-ssh-primary{background:#4169e1;color:white;border-color:#4169e1}.ds-ssh-primary:hover:enabled{background:#365bc7}.ds-ssh-button:focus-visible,.ds-ssh-field input:focus-visible,.ds-ssh-field select:focus-visible,.ds-ssh-config:focus-visible{outline:2px solid #6a8cf0;outline-offset:2px}\n.ds-ssh-config{box-sizing:border-box;width:100%;min-height:240px;resize:vertical;border:1px solid var(--dsw-alias-border-l3,#c5cbd5);border-radius:10px;background:var(--dsw-alias-bg-base,#fff);color:inherit;padding:12px;font:12px/1.7 ui-monospace,Consolas,monospace;tab-size:2;margin:10px 0}.ds-ssh-config-path{font-size:11px;overflow-wrap:anywhere}.ds-ssh-notice,.ds-ssh-trust,.ds-ssh-error{margin:12px 0;padding:12px 14px;border:1px solid var(--dsw-alias-border-l3,#c5cbd5);border-radius:10px;overflow-wrap:anywhere}.ds-ssh-error{color:var(--dsw-alias-state-error-primary,#c43645);background:rgba(220,60,70,.06)}.ds-ssh-trust{background:rgba(220,160,40,.08)}.ds-ssh-trust code,.ds-ssh-known code{display:block;font-size:12px;overflow-wrap:anywhere}.ds-ssh-credentials{margin:10px 0}.ds-ssh-credentials summary{cursor:pointer;font-size:13px}.ds-ssh-session,.ds-ssh-known{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 0}.ds-ssh-session span{flex:1;min-width:220px;overflow-wrap:anywhere}.ds-ssh-known code{flex:1;min-width:260px}\n.ds-ssh-backdrop{position:fixed;inset:0;z-index:20000;background:#0006;display:flex;align-items:center;justify-content:center;padding:24px}.ds-ssh-dialog{box-sizing:border-box;width:min(660px,100%);max-height:90vh;overflow:auto;border:1px solid var(--dsw-alias-border-l3,#c5cbd5);border-radius:18px;background:var(--dsw-alias-bg-base,#fff);padding:24px;box-shadow:0 20px 90px #0003;outline:none}.ds-ssh-choices{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:24px 0 12px}.ds-ssh-choices .ds-ssh-button{flex-direction:column;align-items:flex-start;padding:24px 20px;min-height:120px}.ds-ssh-choices strong{font-size:16px}.ds-ssh-choices span{font-size:12px;opacity:.7}.ds-ssh-files{display:flex;flex-direction:column;max-height:230px;overflow:auto;border:1px solid var(--dsw-alias-border-l3,#c5cbd5);border-radius:10px;padding:6px}.ds-ssh-files .ds-ssh-button{justify-content:flex-start;border:0;background:transparent}\n.ds-ssh-remote{position:fixed;inset:0;z-index:19000;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#fff)}.ds-ssh-remote-bar{display:flex;align-items:center;gap:12px;min-height:42px;padding:4px 14px;border-bottom:1px solid var(--dsw-alias-border-l3,#c5cbd5);background:var(--dsw-alias-bg-layer-2,#f2f4f8)}.ds-ssh-remote-bar strong{white-space:nowrap;font-size:12px}.ds-ssh-remote-bar>span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.ds-ssh-remote-bar .ds-ssh-button{min-height:28px;font-size:12px;padding:3px 10px}.ds-ssh-remote iframe{border:0;flex:1;width:100%;min-height:0;background:white}.ds-ssh-disconnected{max-width:650px;margin:auto;padding:32px}\n@media(max-width:600px){.ds-ssh-choices{grid-template-columns:1fr}.ds-ssh-dialog{padding:18px}.ds-ssh-settings{padding:12px}.ds-ssh-backdrop{padding:12px}}\n";
const {createElement: h, useState, useEffect, useRef} = React;
const ID = 'deepseek-harness-ssh';
const inject = ['slots', 'uiWorkspace'];
let remoteView = null;
const viewListeners = new Set();
function showRemote(value) { remoteView = value; for (const listener of viewListeners) listener(value); }
async function api(input, signal) {
  const send = globalThis.__DSH_TRANSPORT__?.fetch ?? globalThis.fetch.bind(globalThis);
  const response = await send('/api/dsh-ssh', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(input), signal});
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error?.message || 'SSH 请求失败'), data.error);
  return data;
}
function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('操作已取消', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, {once: true}); if (signal?.aborted) abort();
  });
}
async function action(input, signal) {
  const {jobId} = await api(input, signal);
  try {
    while (true) {
      const job = await api({action: 'poll', jobId}, signal);
      if (job.done) { if (job.error) throw Object.assign(new Error(job.error.message), job.error); return job.result; }
      await pause(500, signal);
    }
  } catch (e) { if (signal?.aborted) api({action: 'cancel', jobId}).catch(() => {}); throw e; }
}
function useOperation() {
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), [result, setResult] = useState(null);
  const controller = useRef(null), retry = useRef(null), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  const run = async (fn, remember = true) => {
    if (controller.current) return;
    const c = new AbortController(); controller.current = c; if (remember) retry.current = fn; setBusy(true); setError(null);
    try { const value = await fn(c.signal); if (alive.current) setResult(value); return value; }
    catch (e) { if (alive.current && e.name !== 'AbortError') setError(e); }
    finally { controller.current = null; if (alive.current) setBusy(false); }
  };
  return {busy, error, result, run, cancel: () => controller.current?.abort(), trust: () => { const fn = retry.current; return run(async signal => { await api({action: 'trust', challengeId: error.details.challengeId}, signal); return fn(signal); }, false); }};
}
function Button({children, onClick, disabled, primary, ...rest}) { return h('button', {type: 'button', className: `ds-ssh-button${primary ? ' ds-ssh-primary' : ''}`, disabled, onClick, ...rest}, children); }
function Notice({op}) {
  if (!op.error) return op.busy ? h('div', {className: 'ds-ssh-notice', role: 'status'}, '正在处理… ', h(Button, {onClick: op.cancel}, '取消操作')) : null;
  const error = op.error;
  if (error.code === 'HOST_KEY_UNKNOWN') return h('div', {className: 'ds-ssh-trust', role: 'alert'},
    h('strong', null, '确认远端主机身份'), h('p', null, error.details.alias + ' · ' + error.details.endpoint), h('code', null, error.details.fingerprint),
    h('p', null, '请与管理员或服务器本机显示的 SSH 主机指纹核对。一致后再信任。'),
    h(Button, {primary: true, onClick: op.trust, disabled: op.busy}, '指纹一致，信任并继续'));
  return h('div', {className: 'ds-ssh-error', role: 'alert'}, error.message,
    error.code === 'HOST_KEY_CHANGED' && h('p', null, '已阻止连接。核实服务器身份后，可在 SSH 设置的已信任主机中移除旧指纹，再重新检查连接。'));
}
function Field({label, ...props}) { return h('label', {className: 'ds-ssh-field'}, h('span', null, label), h('input', props)); }
function Credentials({hosts, alias, secrets, setSecrets, disabled}) {
  const chain = []; let host = hosts.find(x => x.alias === alias);
  while (host && chain.length < 5) { chain.push(host); host = hosts.find(x => x.alias === host.proxyJump); }
  return h('details', {className: 'ds-ssh-credentials'}, h('summary', null, '临时认证（密码或加密私钥口令）'),
    h('p', {className: 'ds-ssh-muted'}, '已配置的私钥 / SSH Agent 会自动尝试。下面的内容仅用于本次连接，不保存到磁盘。'),
    chain.map(item => h('div', {key: item.alias, className: 'ds-ssh-row'},
      h(Field, {label: `${item.alias} 密码`, type: 'password', autoComplete: 'off', value: secrets[item.alias]?.password || '', disabled,
        onChange: e => setSecrets(old => ({...old, [item.alias]: {...old[item.alias], password: e.target.value}}))}),
      item.identityFile && h(Field, {label: `${item.alias} 私钥口令`, type: 'password', autoComplete: 'off', value: secrets[item.alias]?.passphrase || '', disabled,
        onChange: e => setSecrets(old => ({...old, [item.alias]: {...old[item.alias], passphrase: e.target.value}}))}))));
}
function ConnectionResult({value}) {
  if (!value?.ssh) return null;
  return h('div', {className: 'ds-ssh-notice', role: 'status'},
    h('strong', null, value.ready ? '连接检查通过，可创建远程工作区' : 'SSH / SFTP 已连接，远端运行时尚未就绪'),
    h('p', null, `主目录 ${value.home} · 检查耗时 ${value.latencyMs} ms`),
    value.runtime && h('p', null, `${value.runtime.platform} · Node ${value.runtime.node} · DSH ${value.runtime.installedVersion || '未安装'}`),
    value.runtimeError && h('p', null, value.runtimeError),
    !value.ready && h('p', null, '远端需要 Linux/macOS、Node ≥22.12.0 与 npm。可使用下方按钮安装固定版本 DSH；安装完成后重新检查连接。'));
}
function Settings({ctx}) {
  const [config, setConfig] = useState(null), [text, setText] = useState(''), [alias, setAlias] = useState('');
  const [secrets, setSecrets] = useState({}), [known, setKnown] = useState({}), [sessions, setSessions] = useState([]), [installConfirm, setInstallConfirm] = useState(false);
  const op = useOperation();
  const accept = data => { setConfig(data); setText(data.text); setAlias(old => data.hosts.some(x => x.alias === old) ? old : data.hosts[0]?.alias || ''); };
  const load = async signal => { const data = await api({action: 'config'}, signal); accept(data); setKnown(await api({action: 'known'}, signal)); setSessions(await api({action: 'sessions'}, signal)); };
  useEffect(() => { op.run(load); }, []);
  return h('section', {className: 'ds-ssh-settings'},
    h('h2', null, 'SSH 远程工作区'), h('p', {className: 'ds-ssh-muted'}, '配置远程电脑，在新建工作区时选择远程目录。文件、终端和模型工具由远端 DSH 处理。'),
    h('div', {className: 'ds-ssh-card'}, h('h3', null, '连接配置'),
      h('p', {className: 'ds-ssh-muted'}, '使用独立的 OpenSSH 风格配置，Host 为别名。支持 HostName、User、Port、IdentityFile、IdentityAgent、ProxyJump、NodePath、ConnectTimeout、ServerAliveInterval。'),
      config && h('code', {className: 'ds-ssh-config-path'}, config.path),
      h('textarea', {'aria-label': 'SSH 连接配置', spellCheck: false, className: 'ds-ssh-config', value: text, disabled: !config || op.busy, onChange: e => setText(e.target.value)}),
      h('div', {className: 'ds-ssh-row'},
        h(Button, {primary: true, disabled: !config || op.busy, onClick: () => op.run(async signal => { const data = await api({action: 'save', text, revision: config.revision}, signal); accept(data); return {saved: true}; })}, '保存配置'),
        h(Button, {disabled: op.busy, onClick: () => op.run(load)}, '重新加载'),
        op.result?.saved && h('span', {role: 'status'}, '已保存'))),
    h('div', {className: 'ds-ssh-card'}, h('h3', null, '检查连接与远端安装'),
      h('label', {className: 'ds-ssh-field'}, 'SSH 主机', h('select', {'aria-label': 'SSH 主机', value: alias, disabled: op.busy, onChange: e => { setAlias(e.target.value); setInstallConfirm(false); }},
        h('option', {value: ''}, '选择已保存的主机'), config?.hosts.map(host => h('option', {key: host.alias, value: host.alias}, `${host.alias} — ${host.username}@${host.hostname}:${host.port}`)))),
      h(Credentials, {hosts: config?.hosts || [], alias, secrets, setSecrets, disabled: op.busy}),
      h('div', {className: 'ds-ssh-row'}, h(Button, {primary: true, disabled: !alias || op.busy, onClick: () => op.run(signal => action({action: 'check', alias, secrets}, signal))}, '检查连接'),
        h(Button, {disabled: !alias || op.busy, onClick: () => setInstallConfirm(true)}, '安装远端 DSH 运行时…')),
      installConfirm && h('div', {className: 'ds-ssh-notice'}, h('p', null, `将在 ${alias} 的 ~/.dsh-ssh/runtime/0.2.1-rc.3 中通过 npm 安装 DSH 0.2.1-rc.3。远端需要访问 npm，首次安装可能需要数分钟。`),
        h(Button, {primary: true, disabled: op.busy, onClick: () => { setInstallConfirm(false); op.run(signal => action({action: 'install', alias, secrets}, signal)); }}, '开始远端安装'),
        h(Button, {disabled: op.busy, onClick: () => setInstallConfirm(false)}, '取消')),
      h(ConnectionResult, {value: op.result}), op.result?.installed && h('p', {role: 'status'}, '远端运行时安装成功，请重新检查连接。')),
    h(Notice, {op}),
    sessions.length > 0 && h('div', {className: 'ds-ssh-card'}, h('h3', null, '远程工作区连接'), sessions.map(session => h('div', {key: session.id, className: 'ds-ssh-session'},
      h('span', null, `${session.alias} · ${session.path} · ${session.state === 'connected' ? '已连接' : '已断开'}`),
      session.state === 'connected' && h(Button, {disabled: op.busy, onClick: () => op.run(async signal => { showRemote(await api({action: 'session', id: session.id}, signal)); })}, '打开'),
      h(Button, {disabled: op.busy, onClick: () => op.run(async signal => { await api({action: 'disconnect', id: session.id}, signal); setSessions(await api({action: 'sessions'}, signal)); })}, '断开')))),
    Object.keys(known).length > 0 && h('div', {className: 'ds-ssh-card'}, h('h3', null, '已信任主机'), Object.entries(known).map(([endpoint, fingerprint]) => h(KnownHost, {key: endpoint, endpoint, fingerprint, disabled: op.busy, remove: () => op.run(async signal => { await api({action: 'forget', endpoint}, signal); setKnown(await api({action: 'known'}, signal)); })}))),
    h('p', {className: 'ds-ssh-muted'}, '远端首次打开需要单独配置模型账号或 API Key。新建工作区时选择远程目录即可接管。返回本地不会断开远程连接；在此处可以显式断开。'));
}
function KnownHost({endpoint, fingerprint, disabled, remove}) {
  const [confirm, setConfirm] = useState(false);
  return h('div', {className: 'ds-ssh-known'}, h('strong', null, endpoint), h('code', null, fingerprint),
    confirm ? h('div', null, h('p', null, '移除后，下次连接必须重新核对服务器指纹。'), h(Button, {disabled, onClick: remove}, '确认移除旧指纹'), h(Button, {onClick: () => setConfirm(false)}, '取消')) : h(Button, {disabled, onClick: () => setConfirm(true)}, '移除…'));
}
function WorkspaceFlow(props) {
  const {ctx, open, onPicked, onCancel} = props;
  const [mode, setMode] = useState('choose'), [config, setConfig] = useState(null), [alias, setAlias] = useState('');
  const [path, setPath] = useState('~'), [local, setLocal] = useState(''), [listing, setListing] = useState(null), [secrets, setSecrets] = useState({}), [bookmarks, setBookmarks] = useState([]);
  const op = useOperation();
  useEffect(() => { if (open) { setMode('choose'); setListing(null); op.run(async signal => { const data = await api({action: 'config'}, signal); setConfig(data); setAlias(data.hosts[0]?.alias || ''); setBookmarks(await api({action: 'bookmarks'}, signal)); }); } else { op.cancel(); setSecrets({}); } }, [open]);
  if (!open) return null;
  const browsePath = target => op.run(async signal => { const value = await action({action: 'browse', alias, path: target, secrets}, signal); setListing(value); setPath(value.path); return value; });
  const close = () => { op.cancel(); onCancel(); };
  return h('div', {className: 'ds-ssh-backdrop', onKeyDown: e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }},
    h('div', {className: 'ds-ssh-dialog', role: 'dialog', 'aria-modal': true, 'aria-label': '新建工作区', tabIndex: -1, ref: node => { if (node && !node.contains(document.activeElement)) node.focus(); }},
      h('div', {className: 'ds-ssh-row'}, h('h2', null, '新建工作区'), h(Button, {'aria-label': '关闭新建工作区', onClick: close}, '×')),
      mode === 'choose' && h('div', {className: 'ds-ssh-choices'},
        h(Button, {disabled: op.busy, onClick: () => setMode('local')}, h('strong', null, '本地文件夹'), h('span', null, '在这台电脑上工作')),
        h(Button, {disabled: op.busy, onClick: () => setMode('remote')}, h('strong', null, '远程文件夹 · SSH'), h('span', null, '连接远程电脑并接管目录'))),
      mode === 'local' && h('div', {className: 'ds-ssh-stack'},
        h('p', null, '选择本机已有文件夹作为工作区。'), h(Field, {label: '本地文件夹绝对路径', value: local, disabled: op.busy, onChange: e => setLocal(e.target.value), placeholder: 'D:\\projects\\my-project'}),
        h('div', {className: 'ds-ssh-row'},
          h(Button, {disabled: op.busy, onClick: () => op.run(async () => { const path = await (globalThis.__DSH_DIRECTORY_PICKER__?.pick() ?? ctx.uiWorkspace.pickDirectory()); if (path) setLocal(path); })}, '浏览本地文件夹…'),
          h(Button, {primary: true, disabled: !local.trim() || op.busy, onClick: () => onPicked(local.trim())}, '创建本地工作区'))),
      mode === 'remote' && h('div', {className: 'ds-ssh-stack'},
        h('label', {className: 'ds-ssh-field'}, '远程电脑', h('select', {'aria-label': '远程电脑', value: alias, disabled: op.busy, onChange: e => { setAlias(e.target.value); setPath('~'); setListing(null); }},
          h('option', {value: ''}, '请选择'), config?.hosts.map(host => h('option', {key: host.alias, value: host.alias}, `${host.alias} — ${host.username}@${host.hostname}`)))),
        config && !config.hosts.length && h('p', null, '还没有远程电脑。请关闭此窗口，打开 设置 → SSH 远程工作区，添加并保存 Host 配置。'),
        bookmarks.some(b => config?.hosts.some(x => x.alias === b.alias)) && h('label', {className: 'ds-ssh-field'}, '最近的远程工作区', h('select', {'aria-label': '最近的远程工作区', value: '', disabled: op.busy, onChange: e => { if (!e.target.value) return; const b = bookmarks[Number(e.target.value)]; setAlias(b.alias); setPath(b.path); setListing(null); }}, h('option', {value: ''}, '选择历史目录…'), bookmarks.map((b, i) => config?.hosts.some(x => x.alias === b.alias) && h('option', {key: i, value: String(i)}, `${b.alias} · ${b.path}`)))),
        h(Credentials, {hosts: config?.hosts || [], alias, secrets, setSecrets, disabled: op.busy}),
        h('div', {className: 'ds-ssh-row'}, h(Field, {label: '远程目录', value: path, disabled: op.busy, placeholder: '~/projects', onChange: e => setPath(e.target.value)}),
          h(Button, {disabled: !alias || op.busy, onClick: () => browsePath(path)}, '浏览目录')),
        listing && h('div', {className: 'ds-ssh-files', 'aria-label': '远程目录列表'},
          h(Button, {disabled: op.busy, onClick: () => browsePath(listing.path === '/' ? '/' : listing.path.slice(0, listing.path.lastIndexOf('/')) || '/')}, '↑ 上级目录'),
          listing.directories.map(entry => h(Button, {key: entry.name, disabled: op.busy, onClick: () => browsePath((listing.path === '/' ? '' : listing.path) + '/' + entry.name)}, '▸ ' + entry.name + (entry.symlink ? ' ↗' : ''))),
          !listing.directories.length && h('p', {className: 'ds-ssh-muted'}, '此目录中没有子目录'), listing.truncated && h('p', null, '只显示前 2000 个目录，可输入完整路径继续。')),
        h('p', {className: 'ds-ssh-muted'}, '远端需安装 DSH 运行时。文件侧栏、终端、聊天与模型配置均属于远程电脑。'),
        h(Button, {primary: true, disabled: !alias || !path.trim() || op.busy, onClick: () => op.run(async signal => { const session = await action({action: 'open', alias, path, secrets}, signal); showRemote(session); onCancel(); })}, '连接并创建远程工作区')),
      h(Notice, {op}),
      mode !== 'choose' && h(Button, {disabled: op.busy, onClick: () => setMode('choose')}, '返回选择')));
}
function RemoteOverlay() {
  const [session, setSession] = useState(remoteView), [error, setError] = useState(null);
  const op = useOperation();
  useEffect(() => { viewListeners.add(setSession); return () => viewListeners.delete(setSession); }, []);
  useEffect(() => {
    if (!session) return;
    let disposed = false, timer, controller = new AbortController();
    const poll = async () => {
      try {
        const current = await api({action: 'session', id: session.id}, controller.signal);
        if (!disposed) { setError(null); if (current.state !== 'connected') setSession({...session, state: 'disconnected', url: null}); }
      } catch (e) { if (!disposed) setError('无法确认 SSH 连接状态：' + e.message); }
      if (!disposed) timer = setTimeout(poll, 2500);
    };
    timer = setTimeout(poll, 2500);
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, [session?.id, session?.state]);
  if (!session) return null;
  return h('div', {className: 'ds-ssh-remote', 'data-ssh-state': session.state},
    h('div', {className: 'ds-ssh-remote-bar'}, h('strong', null, `SSH · ${session.alias}`), h('span', {title: session.path}, session.path),
      h(Button, {onClick: () => showRemote(null)}, '返回本地'),
      h(Button, {disabled: op.busy, onClick: () => op.run(async signal => { await api({action: 'disconnect', id: session.id}, signal); showRemote(null); })}, '断开连接')),
    error && h('div', {className: 'ds-ssh-error', role: 'alert'}, error),
    session.state === 'connected' && !error ? h('iframe', {key: session.id, src: session.url, title: `SSH 远程工作区 ${session.alias}`, referrerPolicy: 'no-referrer', allow: 'clipboard-read; clipboard-write'}) :
      h('div', {className: 'ds-ssh-disconnected'}, h('h2', null, '远程连接已断开'), h('p', null, '远程会话数据保留在服务器上。重新连接后可以继续工作。'),
        h('p', null, '若使用临时密码或密钥口令，请返回本地后从新建工作区重新输入。'),
        h(Button, {primary: true, disabled: op.busy, onClick: () => op.run(async signal => { showRemote(await action({action: 'open', alias: session.alias, path: session.path}, signal)); })}, '重新连接'), h(Notice, {op})));
}
function apply(ctx) {
  ctx.effect(() => { const style = document.createElement('style'); style.dataset.plugin = ID; style.textContent = CSS; document.head.appendChild(style); return () => { style.remove(); showRemote(null); }; });
  ctx.slots.inject('settings.section', () => ctx.slots.register({name: 'settings.section', id: ID, order: 35, label: () => 'SSH 远程工作区', inject: () => ({ctx})}, Settings));
  for (const name of ['sidebar.workspaces.directoryFlow', 'conversation.hero.workspace.directoryFlow']) ctx.slots.inject(name, () => ctx.slots.register({name, priority: -100, inject: () => ({ctx})}, WorkspaceFlow));
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({name: 'shell.overlay', id: ID, order: 90}, RemoteOverlay));
}

return {apply,inject};
}});

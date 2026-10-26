const {createElement: h, useState, useEffect, useRef} = React;
const ID = 'deepseek-harness-ssh';
const inject = ['slots', 'uiWorkspace'];
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
  const controller = useRef(null), retry = useRef(null), credentials = useRef({}), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  const run = async (fn, remember = true) => {
    if (controller.current) return;
    const c = new AbortController(); controller.current = c; if (remember) { retry.current = fn; credentials.current = {}; } setBusy(true); setError(null);
    try { const value = await fn(c.signal, credentials.current); if (alive.current) setResult(value); return value; }
    catch (e) { if (alive.current && e.name !== 'AbortError') setError(e); }
    finally { controller.current = null; if (alive.current) setBusy(false); }
  };
  return {busy, error, result, run, cancel: () => controller.current?.abort(), clearCredentials: () => { credentials.current = {}; },
    authenticate: value => { credentials.current = mergeSecrets(credentials.current, value); return run(retry.current, false); },
    trust: () => { const fn = retry.current; return run(async (signal, extra) => { await api({action: 'trust', challengeId: error.details.challengeId}, signal); return fn(signal, extra); }, false); }};
}
function mergeSecrets(base = {}, extra = {}) { const result = {...base}; for (const [alias, value] of Object.entries(extra)) result[alias] = {...result[alias], ...value}; return result; }
function Icon({kind, size = 22}) {
  const paths = {folder: ['M3 7h6l2-3h10v16H3z'], server: ['M4 3h16v7H4z','M4 14h16v7H4z','M7 6.5h.01','M7 17.5h.01','M11 6.5h6','M11 17.5h6'], arrow: ['m9 5 7 7-7 7'], check: ['m5 12 4 4L19 6']};
  return h('svg', {width:size,height:size,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.6,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true}, (paths[kind] || paths.folder).map((d,i)=>h('path',{d,key:i})));
}
function Button({children, onClick, disabled, primary, ...rest}) { return h('button', {type: 'button', className: `ds-ssh-button${primary ? ' ds-ssh-primary' : ''}`, disabled, onClick, ...rest}, children); }
function AuthenticationPrompt({error, busy, submit}) {
  const [value, setValue] = useState(''), [show, setShow] = useState(false); const details = error.details, passphrase = details.kind === 'passphrase';
  return h('form', {className: 'ds-ssh-trust', 'aria-label': 'SSH 认证', onSubmit: e => { e.preventDefault(); if (value) { submit({[details.alias]: {[passphrase ? 'passphrase' : 'password']: value}}); setValue(''); } }},
    h('strong', null, error.code === 'SSH_AUTH_FAILED' ? '认证未通过，请重新输入' : '请输入 SSH 认证信息'),
    h('p', null, `${details.alias} · ${details.username}@${details.hostname}`),
    h('div', {className:'ds-ssh-password'}, h(Field, {label: passphrase ? '私钥口令' : 'SSH 登录密码', type: show ? 'text' : 'password', autoComplete: 'off', autoFocus: true, value, disabled: busy, onChange: e => setValue(e.target.value)}), h(Button, {onClick:()=>setShow(!show),'aria-pressed':show,disabled:busy}, show?'隐藏密码':'显示密码')),
    h('p', {className: 'ds-ssh-muted'}, '仅在当前窗口中临时使用，不保存到配置文件。输入后会继续刚才的操作。'),
    h('button', {className: 'ds-ssh-button ds-ssh-primary', type: 'submit', disabled: busy || !value}, '验证并继续'));
}
function Notice({op, onCredentials}) {
  if (!op.error) return op.busy ? h('div', {className: 'ds-ssh-notice', role: 'status'}, '正在处理… ', h(Button, {onClick: op.cancel}, '取消操作')) : null;
  const error = op.error;
  if (['SSH_AUTH_REQUIRED', 'SSH_AUTH_FAILED'].includes(error.code)) return h(AuthenticationPrompt, {key: `${error.details.alias}:${error.details.kind}:${error.code}`, error, busy: op.busy, submit: value => { onCredentials?.(value); op.authenticate(value); }});
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
    h('div', {className:'ds-ssh-result-title'}, h(Icon,{kind:'check',size:18}), h('strong', null, value.ready ? '连接检查通过，可创建远程工作区' : 'SSH 连接尚未就绪')),
    h('p', null, `主目录 ${value.home} · 检查耗时 ${value.latencyMs} ms`),
    h('p', null, '由本地 DSH 直接读写远程目录，继续使用本地账号、模型和聊天。'));
}
function Settings({ctx}) {
  const [config, setConfig] = useState(null), [text, setText] = useState(''), [alias, setAlias] = useState('');
  const [secrets, setSecrets] = useState({}), [known, setKnown] = useState({}), [sessions, setSessions] = useState([]);
  const [configOpen, setConfigOpen] = useState(true);
  const op = useOperation();
  const accept = data => { setConfig(data); setText(data.text); setAlias(old => data.hosts.some(x => x.alias === old) ? old : data.hosts[0]?.alias || ''); };
  const load = async signal => { const data = await api({action: 'config'}, signal); accept(data); setKnown(await api({action: 'known'}, signal)); setSessions(await api({action: 'sessions'}, signal)); };
  useEffect(() => { op.run(load); }, []);
  return h('section', {className: 'ds-ssh-settings'},
    h('div', {className:'ds-ssh-heading'}, h('span',{className:'ds-ssh-icon-tile'},h(Icon,{kind:'server'})),h('div',null,h('h2', null, 'SSH 远程工作区'),h('span',{className:'ds-ssh-muted'},'本地模型 · 远程文件'))), h('p', {className: 'ds-ssh-muted'}, '把远程文件夹加入本地工作区列表。本地 DSH 使用现有模型和账号，通过 SSH 读取、写入和执行命令。'),
    h('details', {className: 'ds-ssh-card ds-ssh-config-card',open:configOpen,onToggle:e=>setConfigOpen(e.currentTarget.open)}, h('summary',null,h('strong',null,'连接配置'),h('span',{className:'ds-ssh-muted'},config?.hosts.length?`${config.hosts.length} 台远程电脑 · 编辑配置`:'添加你的第一台远程电脑')),
      h('p', {className: 'ds-ssh-muted'}, '使用独立的 OpenSSH 风格配置，Host 为别名。支持 HostName、User、Port、IdentityFile、IdentityAgent、ProxyJump、ConnectTimeout、ServerAliveInterval。'),
      config && h('code', {className: 'ds-ssh-config-path'}, config.path),
      h('textarea', {'aria-label': 'SSH 连接配置', spellCheck: false, className: 'ds-ssh-config', value: text, disabled: !config || op.busy, onChange: e => setText(e.target.value)}),
      h('div', {className: 'ds-ssh-row'},
        h(Button, {primary: true, disabled: !config || op.busy, onClick: () => op.run(async signal => { const data = await api({action: 'save', text, revision: config.revision}, signal); accept(data); return {saved: true}; })}, '保存配置'),
        h(Button, {disabled: op.busy, onClick: () => op.run(load)}, '重新加载'),
        op.result?.saved && h('span', {role: 'status'}, '已保存'))),
    h('div', {className: 'ds-ssh-card'}, h('h3', null, '连接检查'),
      h('label', {className: 'ds-ssh-field'}, 'SSH 主机', h('select', {'aria-label': 'SSH 主机', value: alias, disabled: op.busy, onChange: e => { setAlias(e.target.value); }},
        h('option', {value: ''}, '选择已保存的主机'), config?.hosts.map(host => h('option', {key: host.alias, value: host.alias}, `${host.alias} — ${host.username}@${host.hostname}:${host.port}`)))),
      h(Credentials, {hosts: config?.hosts || [], alias, secrets, setSecrets, disabled: op.busy}),
      h('div', {className: 'ds-ssh-row'}, h(Button, {primary: true, disabled: !alias || op.busy, onClick: () => op.run((signal, extra) => action({action: 'check', alias, secrets: mergeSecrets(secrets, extra)}, signal))}, '检查连接')),
      h(ConnectionResult, {value: op.result})),
    h(Notice, {op, onCredentials: value => setSecrets(old => mergeSecrets(old, value))}),
    sessions.length > 0 && h('div', {className: 'ds-ssh-card'}, h('h3', null, '远程工作区连接'), sessions.map(session => h('div', {key: session.id, className: 'ds-ssh-session'},
      h('span', null, `${session.alias} · ${session.remoteRoot} · ${session.state === 'connected' ? '已连接' : '已断开'}`),
      h(Button, {disabled: op.busy, onClick: () => ctx.uiWorkspace.openWorkspace(session.workspaceId)}, '打开'),
      h(Button, {disabled: op.busy, onClick: () => op.run(async signal => { await api({action: 'disconnect', id: session.id}, signal); setSessions(await api({action: 'sessions'}, signal)); })}, '断开')))),
    Object.keys(known).length > 0 && h('div', {className: 'ds-ssh-card'}, h('h3', null, '已信任主机'), Object.entries(known).map(([endpoint, fingerprint]) => h(KnownHost, {key: endpoint, endpoint, fingerprint, disabled: op.busy, remove: () => op.run(async signal => { await api({action: 'forget', endpoint}, signal); setKnown(await api({action: 'known'}, signal)); })}))),
    h('p', {className: 'ds-ssh-muted'}, '远端只需要 SSH、SFTP 和 Python 3。不需要远端 DSH、远端模型账号或 API Key。'));
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
  useEffect(() => { if (open) { setMode('choose'); setListing(null); op.run(async signal => { const data = await api({action: 'config'}, signal); setConfig(data); setAlias(data.hosts[0]?.alias || ''); setBookmarks(await api({action: 'bookmarks'}, signal)); }); } else { op.cancel(); op.clearCredentials(); setSecrets({}); } }, [open]);
  if (!open) return null;
  const browsePath = target => op.run(async (signal, extra) => { const value = await action({action: 'browse', alias, path: target, secrets: mergeSecrets(secrets, extra)}, signal); setListing(value); setPath(value.path); return value; });
  const close = () => { op.cancel(); onCancel(); };
  return h('div', {className: 'ds-ssh-backdrop', onKeyDown: e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }},
    h('div', {className: 'ds-ssh-dialog', role: 'dialog', 'aria-modal': true, 'aria-label': '新建工作区', tabIndex: -1, ref: node => { if (node && !node.contains(document.activeElement)) node.focus(); }},
      h('div', {className: 'ds-ssh-row ds-ssh-dialog-header'}, h('div', null,h('span',{className:'ds-ssh-kicker'},'工作区'), h('h2', null, mode === 'choose'?'你想在哪里工作？':mode === 'remote'?'选择远程文件夹':'选择本地文件夹')), h(Button, {'aria-label': '关闭新建工作区', onClick: close}, '×')),
      mode === 'choose' && h('p',{className:'ds-ssh-muted'},'选择项目所在的位置，继续使用这台电脑上的模型和聊天。'),
      mode === 'choose' && h('div', {className: 'ds-ssh-choices'},
        h(Button, {disabled: op.busy, onClick: () => setMode('local')}, h('i',{className:'ds-ssh-choice-icon'},h(Icon,{kind:'folder',size:27})),h('strong', null, '本地文件夹'), h('span', null, '在这台电脑上工作'),h('i',{className:'ds-ssh-choice-arrow'},h(Icon,{kind:'arrow',size:18}))),
        h(Button, {disabled: op.busy, onClick: () => setMode('remote')}, h('i',{className:'ds-ssh-choice-icon'},h(Icon,{kind:'server',size:27})),h('strong', null, '远程文件夹 · SSH'), h('span', null, '连接远程电脑并接管目录'),h('i',{className:'ds-ssh-choice-arrow'},h(Icon,{kind:'arrow',size:18})))),
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
        listing && h('div', {className: 'ds-ssh-directory'},h('div',{className:'ds-ssh-breadcrumb'},h(Icon,{kind:'folder',size:16}),h('code',null,listing.path),h(Button,{disabled:op.busy,onClick:()=>browsePath('~')},'主目录')),h('div', {className: 'ds-ssh-files', 'aria-label': '远程目录列表'},
          h(Button, {disabled: op.busy, onClick: () => browsePath(listing.path === '/' ? '/' : listing.path.slice(0, listing.path.lastIndexOf('/')) || '/')}, '↑ 上级目录'),
          listing.directories.map(entry => h(Button, {key: entry.name, disabled: op.busy, onClick: () => browsePath((listing.path === '/' ? '' : listing.path) + '/' + entry.name)}, '▸ ' + entry.name + (entry.symlink ? ' ↗' : ''))),
          !listing.directories.length && h('p', {className: 'ds-ssh-empty'}, '此目录中没有子目录，可以直接选择当前目录。'), listing.truncated && h('p', null, '只显示前 2000 个目录，可输入完整路径继续。'))),
        h('p', {className: 'ds-ssh-muted'}, '使用本地模型和聊天，文件直接读写到远程电脑。'),
        h(Button, {primary: true, disabled: !alias || !path.trim() || op.busy, onClick: () => op.run(async (signal, extra) => { const workspace = await action({action: 'open', alias, path, secrets: mergeSecrets(secrets, extra)}, signal); onPicked(workspace.localRoot); })}, '连接并创建远程工作区')),
      h(Notice, {op, onCredentials: value => setSecrets(old => mergeSecrets(old, value))}),
      mode !== 'choose' && h(Button, {disabled: op.busy, onClick: () => setMode('choose')}, '返回选择')));
}
function AuthenticationRequest({pending}) {
  const op = useOperation();
  useEffect(() => { op.run((signal, secrets) => action({action: 'connect', alias: pending.alias, secrets}, signal)); }, [pending.id]);
  return h('div', {className: 'ds-ssh-backdrop'}, h('div', {className: 'ds-ssh-dialog', role: 'dialog', 'aria-modal': true, 'aria-label': '重新连接 SSH'},
    h('h2', null, '重新连接 SSH · ' + pending.alias), h(Notice, {op}),
    h(Button, {onClick: () => { op.cancel(); api({action: 'auth-cancel', id: pending.id}).catch(() => {}); }}, '取消连接')));
}
function ConnectionAuthentication() {
  const [pending, setPending] = useState(null);
  useEffect(() => {
    let closed = false, timer; const controller = new AbortController();
    const poll = async () => {
      try { const items = await api({action: 'auth-state'}, controller.signal); if (!closed) setPending(items[0] || null); } catch {}
      if (!closed) timer = setTimeout(poll, 1500);
    };
    poll(); return () => { closed = true; controller.abort(); clearTimeout(timer); };
  }, []);
  return pending ? h(AuthenticationRequest, {key: pending.id, pending}) : null;
}
function apply(ctx) {
  ctx.effect(() => { const style = document.createElement('style'); style.dataset.plugin = ID; style.textContent = CSS; document.head.appendChild(style); return () => { style.remove(); }; });
  ctx.slots.inject('settings.section', () => ctx.slots.register({name: 'settings.section', id: ID, order: 35, label: () => 'SSH 远程工作区', inject: () => ({ctx})}, Settings));
  for (const name of ['sidebar.workspaces.directoryFlow', 'conversation.hero.workspace.directoryFlow']) ctx.slots.inject(name, () => ctx.slots.register({name, priority: -100, inject: () => ({ctx})}, WorkspaceFlow));
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({name: 'shell.overlay', id: ID, order: 90}, ConnectionAuthentication));
  ctx.inject(['sidebarRight'], scope => scope.effect(() => {
    // Close only this plugin's obsolete 0.2.0 tabs as their sessions are adopted.
    const migrate = () => {for (const tab of scope.sidebarRight.openTabs.getSnapshot()) if (tab.kind === 'ssh-files') scope.sidebarRight.closeIn(tab.sessionId, tab.tabId);};
    const timer = setInterval(migrate, 1000); migrate();
    return () => clearInterval(timer);
  }));
}

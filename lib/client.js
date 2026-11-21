window.__ModuleLoader__.load({id:'deepseek-harness-ssh',factory:(require)=>{
const React=require('react');
const CSS=".ds-ssh-settings,.ds-ssh-dialog{color:var(--dsw-alias-label-primary,#20242c);font:14px/1.55 system-ui,sans-serif}\n.ds-ssh-settings{box-sizing:border-box;width:100%;min-width:0;max-width:820px;padding:12px 24px 32px;overflow-wrap:anywhere}.ds-ssh-settings h2,.ds-ssh-dialog h2{font-size:20px;font-weight:600;margin:0 0 8px}.ds-ssh-settings h3{font-size:15px;margin:0 0 10px}.ds-ssh-settings p,.ds-ssh-dialog p{margin:8px 0}.ds-ssh-muted{color:var(--dsw-alias-label-secondary,#727784);font-size:13px}\n.ds-ssh-card{padding:20px 0;border-bottom:1px solid var(--dsw-alias-border-l3,#d6dae1)}.ds-ssh-row{display:flex;align-items:center;flex-wrap:wrap;gap:10px}.ds-ssh-row h2{flex:1}.ds-ssh-stack{display:flex;flex-direction:column;gap:12px}.ds-ssh-field{display:flex;flex:1;flex-direction:column;gap:6px;min-width:130px;margin:8px 0}.ds-ssh-field input,.ds-ssh-field select,.ds-ssh-settings select{box-sizing:border-box;width:100%;height:38px;border:1px solid var(--dsw-alias-border-l3,#c5cbd5);border-radius:8px;background:var(--dsw-alias-bg-base,#fff);color:inherit;padding:6px 10px;font:inherit}\n.ds-ssh-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:34px;padding:6px 12px;border:1px solid var(--dsw-alias-border-l3,#c5cbd5);border-radius:8px;background:var(--dsw-alias-bg-base,#fff);color:inherit;font:inherit;cursor:pointer}.ds-ssh-button:hover:enabled{background:var(--dsw-alias-interactive-bg-hover,#edf1f7)}.ds-ssh-button:disabled{opacity:.5;cursor:default}.ds-ssh-primary{background:#4169e1;color:white;border-color:#4169e1}.ds-ssh-primary:hover:enabled{background:#365bc7}.ds-ssh-button:focus-visible,.ds-ssh-field input:focus-visible,.ds-ssh-field select:focus-visible,.ds-ssh-config:focus-visible{outline:2px solid #6a8cf0;outline-offset:2px}\n.ds-ssh-config{box-sizing:border-box;width:100%;min-height:240px;resize:vertical;border:1px solid var(--dsw-alias-border-l3,#c5cbd5);border-radius:10px;background:var(--dsw-alias-bg-base,#fff);color:inherit;padding:12px;font:12px/1.7 ui-monospace,Consolas,monospace;tab-size:2;margin:10px 0}.ds-ssh-config-path{font-size:11px;overflow-wrap:anywhere}.ds-ssh-notice,.ds-ssh-trust,.ds-ssh-error{margin:12px 0;padding:12px 14px;border:1px solid var(--dsw-alias-border-l3,#c5cbd5);border-radius:10px;overflow-wrap:anywhere}.ds-ssh-error{color:var(--dsw-alias-state-error-primary,#c43645);background:rgba(220,60,70,.06)}.ds-ssh-trust{background:rgba(220,160,40,.08)}.ds-ssh-trust code,.ds-ssh-known code{display:block;font-size:12px;overflow-wrap:anywhere}.ds-ssh-session,.ds-ssh-known{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 0}.ds-ssh-session span{flex:1;min-width:220px;overflow-wrap:anywhere}.ds-ssh-known code{flex:1;min-width:260px}\n.ds-ssh-backdrop{position:fixed;inset:0;z-index:20000;background:#0006;display:flex;align-items:center;justify-content:center;padding:24px}.ds-ssh-dialog{box-sizing:border-box;width:min(660px,100%);max-height:90vh;overflow:auto;border:1px solid var(--dsw-alias-border-l3,#c5cbd5);border-radius:18px;background:var(--dsw-alias-bg-base,#fff);padding:24px;box-shadow:0 20px 90px #0003;outline:none}.ds-ssh-choices{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:24px 0 12px}.ds-ssh-choices .ds-ssh-button{flex-direction:column;align-items:flex-start;padding:24px 20px;min-height:120px}.ds-ssh-choices strong{font-size:16px}.ds-ssh-choices span{font-size:12px;opacity:.7}.ds-ssh-files{display:flex;flex-direction:column;max-height:230px;overflow:auto;border:1px solid var(--dsw-alias-border-l3,#c5cbd5);border-radius:10px;padding:6px}.ds-ssh-files .ds-ssh-button{justify-content:flex-start;border:0;background:transparent}\n@media(max-width:600px){.ds-ssh-choices{grid-template-columns:1fr}.ds-ssh-dialog{padding:18px}.ds-ssh-settings{padding:12px}.ds-ssh-backdrop{padding:12px}}\n.ds-ssh-settings{max-width:900px;padding-top:24px}.ds-ssh-heading{display:flex;align-items:center;gap:14px;margin-bottom:16px}.ds-ssh-heading h2{margin:0 0 3px}.ds-ssh-icon-tile{display:grid;place-items:center;width:46px;height:46px;flex-shrink:0;border-radius:13px;background:rgba(100,130,220,.12);color:#7898ee}.ds-ssh-card{border:1px solid var(--dsw-alias-border-l3,#8883);border-radius:12px;margin:18px 0;padding:20px;background:var(--dsw-alias-bg-layer-1,transparent)}.ds-ssh-config-card summary{cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:14px;list-style:none}.ds-ssh-config-card summary::-webkit-details-marker{display:none}.ds-ssh-config-card summary::after{content:'⌄';font-size:17px;color:var(--dsw-alias-label-secondary,#889)}.ds-ssh-config-card[open] summary{margin-bottom:12px}.ds-ssh-config-card summary span{margin-left:auto}.ds-ssh-config{min-height:210px}.ds-ssh-dialog{padding:28px;border-radius:18px;box-shadow:0 28px 100px #0005}.ds-ssh-dialog-header{justify-content:space-between;align-items:flex-start;margin-bottom:10px}.ds-ssh-dialog-header h2{font-size:23px;margin:7px 0 0;letter-spacing:-.4px}.ds-ssh-dialog-header>.ds-ssh-button{min-width:32px;padding:3px;border:0;background:transparent;font-size:24px;color:var(--dsw-alias-label-secondary,#889)}.ds-ssh-kicker{font-size:11px;letter-spacing:1.5px;color:var(--dsw-alias-label-secondary,#889)}.ds-ssh-choices{gap:14px;margin-top:24px}.ds-ssh-choices .ds-ssh-button{position:relative;min-height:184px;gap:7px;padding:22px;border-color:var(--dsw-alias-border-l3,#8884);transition:border-color .15s,background .15s,transform .15s}.ds-ssh-choices .ds-ssh-button:hover:enabled{border-color:#7898ee;transform:translateY(-2px)}.ds-ssh-choice-icon{display:grid;place-items:center;width:42px;height:42px;background:rgba(120,140,180,.1);border-radius:11px;margin-bottom:13px;color:#8da5df}.ds-ssh-choice-arrow{position:absolute;right:16px;top:24px;color:var(--dsw-alias-label-secondary,#889)}.ds-ssh-choices span{font-size:12px;opacity:1;color:var(--dsw-alias-label-secondary,#889)}.ds-ssh-dialog .ds-ssh-stack{margin-top:20px}.ds-ssh-breadcrumb{display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l3,#8883);border-bottom:0;border-radius:10px 10px 0 0;color:var(--dsw-alias-label-secondary,#889)}.ds-ssh-breadcrumb code{flex:1;min-width:0;font-size:12px;overflow-wrap:anywhere}.ds-ssh-breadcrumb .ds-ssh-button{font-size:12px;min-height:26px;padding:2px 8px}.ds-ssh-directory .ds-ssh-files{border-radius:0 0 10px 10px;max-height:255px}.ds-ssh-directory .ds-ssh-button{font-size:13px}.ds-ssh-empty{padding:18px;text-align:center;font-size:13px;color:var(--dsw-alias-label-secondary,#889)}.ds-ssh-password{display:flex;align-items:flex-end;gap:8px}.ds-ssh-password>.ds-ssh-button{margin-bottom:8px;min-height:38px;white-space:nowrap}.ds-ssh-result-title{display:flex;gap:8px;align-items:center;color:var(--dsw-alias-state-success-primary,#60a978)}.ds-ssh-trust{padding:18px;background:rgba(190,150,60,.06)}.ds-ssh-trust>strong{font-size:15px}.ds-ssh-trust code{padding:10px;margin:12px 0;background:var(--dsw-alias-bg-base,#8881);border:1px solid var(--dsw-alias-border-l3,#8883);border-radius:7px;font-family:ui-monospace,Consolas,monospace}.ds-ssh-notice{background:rgba(90,150,100,.05)}\n@media(max-width:600px){.ds-ssh-dialog{padding:20px}.ds-ssh-choices .ds-ssh-button{min-height:142px}.ds-ssh-settings{padding:14px}.ds-ssh-config-card summary{flex-wrap:wrap}.ds-ssh-config-card summary span{margin-left:0}.ds-ssh-card{padding:15px}.ds-ssh-dialog-header h2{font-size:21px}}\n@media(prefers-reduced-motion:reduce){.ds-ssh-choices .ds-ssh-button{transition:none}.ds-ssh-choices .ds-ssh-button:hover:enabled{transform:none}}\n.ds-ssh-dock{isolation:isolate;box-sizing:border-box;width:calc(100% - 2 * var(--dsh-composer-side-clearance,24px) - 4 * var(--dsh-composer-dock-inset,12px));max-width:calc(var(--dsh-composer-card-max-width,748px) - 4 * var(--dsh-composer-dock-inset,12px));margin:0 auto 2px;padding:4px 8px 4px 12px;border-radius:var(--dsw-radius-lg,12px);border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.2));background:var(--dsw-specific-menu,var(--dsw-alias-bg-module-platform,rgba(32,34,42,.85)));backdrop-filter:var(--dsw-menu-backdrop-filter,none);box-shadow:var(--dsw-elevation-panel,none);color:var(--dsw-alias-label-primary,inherit);font:12px/1.4 var(--dsw-font-family,system-ui,sans-serif)}\n.ds-ssh-dock-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-height:28px}\n.ds-ssh-dot{width:7px;height:7px;border-radius:999px;flex:none;background:var(--dsw-alias-label-tertiary,#8b92a0)}\n.ds-ssh-dot-busy{background:var(--dsw-alias-button-info-fill,#4169e1)}\n.ds-ssh-dot-err{background:var(--dsw-alias-state-error-primary,#e05260)}\n.ds-ssh-dock-title{font-weight:500;white-space:nowrap;color:var(--dsw-alias-label-primary,inherit)}\n.ds-ssh-dock-host{font-weight:500;color:var(--dsw-alias-label-secondary,inherit)}\n.ds-ssh-dock-select{height:26px;max-width:240px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.22));border-radius:var(--dsw-radius-sm,7px);background:var(--dsw-alias-bg-module-platform,rgba(128,128,128,.1));color:var(--dsw-alias-label-primary,inherit);font:inherit;cursor:pointer}\n.ds-ssh-dock-select:focus-visible{outline:2px solid var(--dsw-focus-ring-color,#6a8cf0);outline-offset:1px}\n.ds-ssh-dock-actions{display:flex;align-items:center;gap:6px;margin-left:auto}\n.ds-ssh-dock .ds-ssh-button{min-height:26px;padding:0 10px;font-size:12px;border-radius:var(--dsw-radius-sm,7px);border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.22));background:transparent;color:var(--dsw-alias-label-secondary,inherit)}\n.ds-ssh-dock .ds-ssh-button:hover:enabled{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));color:var(--dsw-alias-label-primary,inherit)}\n.ds-ssh-dock .ds-ssh-primary{background:var(--dsw-alias-button-info-fill,#4169e1);color:var(--dsw-alias-label-on-color,#fff);border-color:transparent}\n.ds-ssh-dock .ds-ssh-primary:hover:enabled{background:var(--dsw-alias-button-info-hover,#365bc7);color:var(--dsw-alias-label-on-color,#fff)}\n.ds-ssh-dock .ds-ssh-icon-btn{min-width:26px;width:26px;height:26px;min-height:26px;padding:0;border:none;border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary,inherit);font-size:15px;line-height:1}\n.ds-ssh-dock .ds-ssh-icon-btn:hover:enabled{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.16));color:var(--dsw-alias-label-primary,inherit)}\n.ds-ssh-dock-body{margin-top:6px;padding-top:6px;border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.14))}\n.ds-ssh-dock .ds-ssh-trust,.ds-ssh-dock .ds-ssh-notice,.ds-ssh-dock .ds-ssh-error{margin:0;padding:8px 10px;border-radius:var(--dsw-radius-sm,8px);font-size:12px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18))}\n.ds-ssh-dock .ds-ssh-error{background:rgba(220,60,70,.08);border-color:rgba(220,60,70,.24);color:var(--dsw-alias-state-error-primary,#e05260)}\n.ds-ssh-dock .ds-ssh-trust{background:var(--dsw-alias-bg-module-platform,rgba(128,128,128,.08))}\n.ds-ssh-dock .ds-ssh-field{margin:4px 0}\n.ds-ssh-dock .ds-ssh-field input{height:32px;font-size:13px;background:var(--dsw-alias-bg-base,rgba(0,0,0,.2));border-color:var(--dsw-alias-border-l2,rgba(128,128,128,.24))}\n.ds-ssh-dock .ds-ssh-password>.ds-ssh-button{margin-bottom:4px;min-height:32px}\n";
const {createElement: h, useState, useEffect, useRef} = React;
const ID = 'deepseek-harness-ssh';
const inject = ['slots', 'uiWorkspace', 'contextMenus'];
const activeSessionDocks = new Map();
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
async function action(input, signal, onChallenge) {
  const {jobId} = await api(input, signal);
  let lastChallengeId = null;
  try {
    while (true) {
      const job = await api({action: 'poll', jobId}, signal);
      if (job.done) {
        onChallenge?.(null);
        if (job.error) throw Object.assign(new Error(job.error.message), job.error);
        return job.result;
      }
      if (job.challenge) {
        if (job.challenge.id !== lastChallengeId) {
          lastChallengeId = job.challenge.id;
          onChallenge?.({
            ...job.challenge,
            reply: answers => api({action: 'challenge-reply', jobId, challengeId: job.challenge.id, answers}, signal)
          });
        }
      } else if (lastChallengeId !== null) {
        lastChallengeId = null;
        onChallenge?.(null);
      }
      await pause(300, signal);
    }
  } catch (e) {
    onChallenge?.(null);
    if (signal?.aborted) api({action: 'cancel', jobId}).catch(() => {});
    throw e;
  }
}
function useOperation() {
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), [result, setResult] = useState(null);
  const [challenge, setChallenge] = useState(null), [challengeBusy, setChallengeBusy] = useState(false);
  const controller = useRef(null), retry = useRef(null), alive = useRef(true), currentChallenge = useRef(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  const onChallenge = value => {
    currentChallenge.current = value;
    if (alive.current) { setChallenge(value); setChallengeBusy(false); }
  };
  const run = async (fn, remember = true) => {
    if (controller.current) return;
    const c = new AbortController(); controller.current = c; if (remember) retry.current = fn;
    setBusy(true); setError(null); onChallenge(null);
    try { const value = await fn(c.signal, undefined, onChallenge); if (alive.current) setResult(value); return value; }
    catch (e) { if (alive.current && e.name !== 'AbortError') setError(e); }
    finally { controller.current = null; onChallenge(null); if (alive.current) setBusy(false); }
  };
  return {busy, error, result, challenge, challengeBusy, canRetry: !!retry.current, run,
    cancel: () => controller.current?.abort(),
    clearError: () => { if (alive.current) setError(null); },
    replyChallenge: async answers => {
      if (!challenge || challengeBusy) return;
      setChallengeBusy(true);
      try {
        await challenge.reply(answers);
        if (currentChallenge.current?.id === challenge.id) onChallenge(null);
      } catch (error) {
        if (alive.current && currentChallenge.current?.id === challenge.id) {
          setChallengeBusy(false);
          if (error.code !== 'CHALLENGE_EXPIRED') setError(error);
        }
      }
    },
    retryFresh: () => retry.current ? run(retry.current, false) : undefined,
    trust: () => { const fn = retry.current; return run(async (signal, extra, cb) => { await api({action: 'trust', challengeId: error.details.challengeId}, signal); return fn(signal, extra, cb); }, false); }};
}
function Icon({kind, size = 22}) {
  const paths = {folder: ['M3 7h6l2-3h10v16H3z'], server: ['M4 3h16v7H4z','M4 14h16v7H4z','M7 6.5h.01','M7 17.5h.01','M11 6.5h6','M11 17.5h6'], arrow: ['m9 5 7 7-7 7'], check: ['m5 12 4 4L19 6']};
  return h('svg', {width:size,height:size,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.6,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true}, (paths[kind] || paths.folder).map((d,i)=>h('path',{d,key:i})));
}
function Button({children, onClick, disabled, primary, className = '', ...rest}) { return h('button', {type: 'button', className: `ds-ssh-button${primary ? ' ds-ssh-primary' : ''}${className ? ' ' + className : ''}`, disabled, onClick, ...rest}, children); }
function formatPromptLabel(raw) {
  const text = String(raw || '').trim();
  if (/2nd|second|one[\s-]*time|otp|totp|verification|token|passcode|2fa|mfa|验证码|动态|一次性|安全码|令牌/i.test(text)) {
    return text ? `动态口令（${text.replace(/:$/, '')}）` : '动态口令';
  }
  if (/password|passphrase|密码|口令/i.test(text)) {
    return text ? `登录密码（${text.replace(/:$/, '')}）` : '登录密码';
  }
  return text || '验证信息';
}
function AuthPrompt({challenge, busy, submit, cancel}) {
  const [values, setValues] = useState(() => challenge.prompts.map(() => ''));
  const ready = values.every(v => v.length > 0);
  return h('form', {className: 'ds-ssh-trust', 'aria-label': 'SSH 交互认证', onSubmit: e => { e.preventDefault(); if (ready && !busy) { submit(values); setValues(challenge.prompts.map(() => '')); } }},
    h('strong', null, challenge.kind === 'passphrase' ? '解锁私钥' : 'SSH 认证'),
    h('p', {className: 'ds-ssh-muted'}, challenge.alias),
    challenge.prompts.map((p, idx) => h('div', {key: idx, className: 'ds-ssh-password'},
      h(Field, {
        label: challenge.kind === 'passphrase' ? '私钥口令' : formatPromptLabel(p.prompt),
        type: p.echo ? 'text' : 'password',
        autoComplete: 'off',
        autoFocus: idx === 0,
        value: values[idx] || '',
        disabled: busy,
        onChange: e => setValues(old => old.map((v, i) => i === idx ? e.target.value : v))
      }))),
    h('div', {className: 'ds-ssh-row'},
      h('button', {className: 'ds-ssh-button ds-ssh-primary', type: 'submit', disabled: busy || !ready}, '继续'),
      cancel && h(Button, {onClick: cancel, disabled: busy}, '取消')));
}
function Notice({op, compact = false, cancel = op.cancel}) {
  if (op.challenge) return h(AuthPrompt, {key: op.challenge.id, challenge: op.challenge, busy: op.challengeBusy, submit: op.replyChallenge, cancel});
  const error = op.error;
  if (!error) return !compact && op.busy ? h('div', {className: 'ds-ssh-notice', role: 'status'}, '正在连接… ', h(Button, {onClick: cancel}, '取消')) : null;
  if (error.code === 'HOST_KEY_UNKNOWN') return h('div', {className: 'ds-ssh-trust', role: 'alert'},
    h('strong', null, '确认远端主机身份'), h('p', null, error.details.alias + ' · ' + error.details.endpoint), h('code', null, error.details.fingerprint),
    h('p', null, '请与管理员核对指纹，一致后再继续。'),
    h(Button, {primary: true, onClick: op.trust, disabled: op.busy}, '指纹一致，信任并继续'));
  return h('div', {className: 'ds-ssh-error', role: 'alert'}, error.message,
    error.code === 'HOST_KEY_CHANGED' ? h('p', null, '请先核实服务器身份，再到 SSH 设置中移除旧指纹。') :
      !compact && op.canRetry && h(Button, {disabled: op.busy, onClick: op.retryFresh}, '重试'));
}
function Field({label, ...props}) { return h('label', {className: 'ds-ssh-field'}, h('span', null, label), h('input', props)); }
function ConnectionResult({value}) {
  if (!value?.ssh) return null;
  return h('div', {className: 'ds-ssh-notice', role: 'status'},
    h('div', {className:'ds-ssh-result-title'}, h(Icon,{kind:'check',size:18}), h('strong', null, value.ready ? '连接检查通过，可创建远程工作区' : 'SSH 连接尚未就绪')),
    h('p', null, `主目录 ${value.home} · 检查耗时 ${value.latencyMs} ms`),
    h('p', null, '由本地 DSH 直接读写远程目录，继续使用本地账号、模型和聊天。'));
}
function Settings({ctx}) {
  const [config, setConfig] = useState(null), [text, setText] = useState(''), [alias, setAlias] = useState('');
  const [known, setKnown] = useState({}), [sessions, setSessions] = useState([]);
  const [configOpen, setConfigOpen] = useState(true);
  const op = useOperation();
  const accept = data => { setConfig(data); setText(data.text); setAlias(old => data.hosts.some(x => x.alias === old) ? old : data.hosts[0]?.alias || ''); };
  const load = async signal => { const data = await api({action: 'config'}, signal); accept(data); setKnown(await api({action: 'known'}, signal)); setSessions(await api({action: 'sessions'}, signal)); };
  useEffect(() => { op.run(load); }, []);
  return h('section', {className: 'ds-ssh-settings'},
    h('div', {className:'ds-ssh-heading'}, h('span',{className:'ds-ssh-icon-tile'},h(Icon,{kind:'server'})),h('div',null,h('h2', null, 'SSH 远程工作区'),h('span',{className:'ds-ssh-muted'},'本地模型 · 远程文件'))), h('p', {className: 'ds-ssh-muted'}, '把远程文件夹加入本地工作区列表。本地 DSH 使用现有模型和账号，通过 SSH 读取、写入和执行命令。'),
    h('details', {className: 'ds-ssh-card ds-ssh-config-card',open:configOpen,onToggle:e=>setConfigOpen(e.currentTarget.open)}, h('summary',null,h('strong',null,'连接配置'),h('span',{className:'ds-ssh-muted'},config?.hosts.length?`${config.hosts.length} 台远程电脑 · 编辑配置`:'添加你的第一台远程电脑')),
      h('p', {className: 'ds-ssh-muted'}, '使用独立的 OpenSSH 风格配置，Host 为别名。支持 HostName、User、Port、IdentityFile、IdentityAgent、ProxyJump。需要密码或动态口令时会按提示询问。'),
      config && h('code', {className: 'ds-ssh-config-path'}, config.path),
      h('textarea', {'aria-label': 'SSH 连接配置', spellCheck: false, className: 'ds-ssh-config', value: text, disabled: !config || op.busy, onChange: e => setText(e.target.value)}),
      h('div', {className: 'ds-ssh-row'},
        h(Button, {primary: true, disabled: !config || op.busy, onClick: () => op.run(async signal => { const data = await api({action: 'save', text, revision: config.revision}, signal); accept(data); return {saved: true}; })}, '保存配置'),
        h(Button, {disabled: op.busy, onClick: () => op.run(load)}, '重新加载'),
        op.result?.saved && h('span', {role: 'status'}, '已保存'))),
    h('div', {className: 'ds-ssh-card'}, h('h3', null, '连接检查'),
      h('label', {className: 'ds-ssh-field'}, 'SSH 主机', h('select', {'aria-label': 'SSH 主机', value: alias, disabled: op.busy, onChange: e => { setAlias(e.target.value); }},
        h('option', {value: ''}, '选择已保存的主机'), config?.hosts.map(host => h('option', {key: host.alias, value: host.alias}, `${host.alias} — ${host.username}@${host.hostname}:${host.port}`)))),
      h('div', {className: 'ds-ssh-row'}, h(Button, {primary: true, disabled: !alias || op.busy, onClick: () => op.run((signal, extra, onChallenge) => action({action: 'check', alias}, signal, onChallenge))}, '检查连接')),
      h(ConnectionResult, {value: op.result})),
    h(Notice, {op}),
    sessions.length > 0 && h('div', {className: 'ds-ssh-card'}, h('h3', null, '远程工作区连接'), sessions.map(session => h('div', {key: session.id, className: 'ds-ssh-session'},
      h('span', null, `${session.alias} · ${session.remoteRoot} · ${session.state === 'connected' ? '已连接' : '已断开'}`),
      h(Button, {disabled: op.busy, onClick: () => ctx.uiWorkspace.openWorkspace(session.workspaceId)}, '打开'),
      h(Button, {disabled: op.busy, onClick: () => op.run(async signal => { await api({action: 'disconnect', id: session.id}, signal); setSessions(await api({action: 'sessions'}, signal)); })}, '断开')))),
    Object.keys(known).length > 0 && h('div', {className: 'ds-ssh-card'}, h('h3', null, '已信任主机'), Object.entries(known).map(([endpoint, fingerprint]) => h(KnownHost, {key: endpoint, endpoint, fingerprint, disabled: op.busy, remove: () => op.run(async signal => { await api({action: 'forget', endpoint}, signal); setKnown(await api({action: 'known'}, signal)); })}))),
    h('p', {className: 'ds-ssh-muted'}, '远端只需要 SSH 与 Python 3。不需要远端 DSH、远端模型账号或 API Key。'));
}
function KnownHost({endpoint, fingerprint, disabled, remove}) {
  const [confirm, setConfirm] = useState(false);
  return h('div', {className: 'ds-ssh-known'}, h('strong', null, endpoint), h('code', null, fingerprint),
    confirm ? h('div', null, h('p', null, '移除后，下次连接必须重新核对服务器指纹。'), h(Button, {disabled, onClick: remove}, '确认移除旧指纹'), h(Button, {onClick: () => setConfirm(false)}, '取消')) : h(Button, {disabled, onClick: () => setConfirm(true)}, '移除…'));
}
function WorkspaceFlow(props) {
  const {ctx, open, onPicked, onCancel} = props;
  const [mode, setMode] = useState('choose'), [config, setConfig] = useState(null), [alias, setAlias] = useState('');
  const [path, setPath] = useState('~'), [local, setLocal] = useState(''), [name, setName] = useState(''), [listing, setListing] = useState(null), [bookmarks, setBookmarks] = useState([]);
  const op = useOperation();
  useEffect(() => { if (open) { setMode('choose'); setName(''); setListing(null); op.run(async signal => { const data = await api({action: 'config'}, signal); setConfig(data); setAlias(data.hosts[0]?.alias || ''); setBookmarks(await api({action: 'bookmarks'}, signal)); }); } else { op.cancel(); setName(''); } }, [open]);
  if (!open) return null;
  const browsePath = target => op.run(async (signal, extra, onChallenge) => { const value = await action({action: 'browse', alias, path: target}, signal, onChallenge); setListing(value); setPath(value.path); return value; });
  const close = () => { op.cancel(); onCancel(); };
  const localDefaultName = local.trim().replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'my-project';
  const remoteBaseName = path.trim().replace(/\/+$/, '').split('/').pop() || '/';
  const remoteDefaultName = alias ? `SSH · ${alias} · ${remoteBaseName}` : 'SSH · 主机 · 目录';
  return h('div', {className: 'ds-ssh-backdrop', onKeyDown: e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }},
    h('div', {className: 'ds-ssh-dialog', role: 'dialog', 'aria-modal': true, 'aria-label': '新建工作区', tabIndex: -1, ref: node => { if (node && !node.contains(document.activeElement)) node.focus(); }},
      h('div', {className: 'ds-ssh-row ds-ssh-dialog-header'}, h('div', null,h('span',{className:'ds-ssh-kicker'},'工作区'), h('h2', null, mode === 'choose'?'你想在哪里工作？':mode === 'remote'?'选择远程文件夹':'选择本地文件夹')), h(Button, {'aria-label': '关闭新建工作区', onClick: close}, '×')),
      mode === 'choose' && h('p',{className:'ds-ssh-muted'},'选择项目所在的位置，继续使用这台电脑上的模型和聊天。'),
      mode === 'choose' && h('div', {className: 'ds-ssh-choices'},
        h(Button, {disabled: op.busy, onClick: () => { setName(''); setMode('local'); }}, h('i',{className:'ds-ssh-choice-icon'},h(Icon,{kind:'folder',size:27})),h('strong', null, '本地文件夹'), h('span', null, '在这台电脑上工作'),h('i',{className:'ds-ssh-choice-arrow'},h(Icon,{kind:'arrow',size:18}))),
        h(Button, {disabled: op.busy, onClick: () => { setName(''); setMode('remote'); }}, h('i',{className:'ds-ssh-choice-icon'},h(Icon,{kind:'server',size:27})),h('strong', null, '远程文件夹 · SSH'), h('span', null, '连接远程电脑并接管目录'),h('i',{className:'ds-ssh-choice-arrow'},h(Icon,{kind:'arrow',size:18})))),
      mode === 'local' && h('div', {className: 'ds-ssh-stack'},
        h('p', null, '选择本机已有文件夹作为工作区。'), h(Field, {label: '本地文件夹绝对路径', value: local, disabled: op.busy, onChange: e => setLocal(e.target.value), placeholder: 'D:\\projects\\my-project'}),
        h(Field, {label: '工作区名称（可选）', value: name, disabled: op.busy, maxLength: 120, onChange: e => setName(e.target.value), placeholder: `留空默认使用文件夹名（${localDefaultName}）`}),
        h('div', {className: 'ds-ssh-row'},
          h(Button, {disabled: op.busy, onClick: () => op.run(async () => { const picked = await (globalThis.__DSH_DIRECTORY_PICKER__?.pick() ?? ctx.uiWorkspace.pickDirectory()); if (picked) setLocal(picked); })}, '浏览本地文件夹…'),
          h(Button, {primary: true, disabled: !local.trim() || op.busy, onClick: () => op.run(async signal => { const targetPath = local.trim(), title = name.trim(); if (title) await api({action: 'rename-workspace', path: targetPath, title}, signal); onPicked(targetPath); })}, '创建本地工作区'))),
      mode === 'remote' && h('div', {className: 'ds-ssh-stack'},
        h('label', {className: 'ds-ssh-field'}, '远程电脑', h('select', {'aria-label': '远程电脑', value: alias, disabled: op.busy, onChange: e => { setAlias(e.target.value); setPath('~'); setListing(null); }},
          h('option', {value: ''}, '请选择'), config?.hosts.map(host => h('option', {key: host.alias, value: host.alias}, `${host.alias} — ${host.username}@${host.hostname}`)))),
        config && !config.hosts.length && h('p', null, '还没有远程电脑。请关闭此窗口，打开 设置 → SSH 远程工作区，添加并保存 Host 配置。'),
        bookmarks.some(b => config?.hosts.some(x => x.alias === b.alias)) && h('label', {className: 'ds-ssh-field'}, '最近的远程工作区', h('select', {'aria-label': '最近的远程工作区', value: '', disabled: op.busy, onChange: e => { if (!e.target.value) return; const b = bookmarks[Number(e.target.value)]; setAlias(b.alias); setPath(b.path); setListing(null); }}, h('option', {value: ''}, '选择历史目录…'), bookmarks.map((b, i) => config?.hosts.some(x => x.alias === b.alias) && h('option', {key: i, value: String(i)}, `${b.alias} · ${b.path}`)))),
        h('div', {className: 'ds-ssh-row'}, h(Field, {label: '远程目录', value: path, disabled: op.busy, placeholder: '~/projects', onChange: e => setPath(e.target.value)}),
          h(Button, {disabled: !alias || op.busy, onClick: () => browsePath(path)}, '浏览目录')),
        h(Field, {label: '工作区名称（可选）', value: name, disabled: op.busy, maxLength: 120, onChange: e => setName(e.target.value), placeholder: `留空默认：${remoteDefaultName}`}),
        listing && h('div', {className: 'ds-ssh-directory'},h('div',{className:'ds-ssh-breadcrumb'},h(Icon,{kind:'folder',size:16}),h('code',null,listing.path),h(Button,{disabled:op.busy,onClick:()=>browsePath('~')},'主目录')),h('div', {className: 'ds-ssh-files', 'aria-label': '远程目录列表'},
          h(Button, {disabled: op.busy, onClick: () => browsePath(listing.path === '/' ? '/' : listing.path.slice(0, listing.path.lastIndexOf('/')) || '/')}, '↑ 上级目录'),
          listing.directories.map(entry => h(Button, {key: entry.name, disabled: op.busy, onClick: () => browsePath((listing.path === '/' ? '' : listing.path) + '/' + entry.name)}, '▸ ' + entry.name + (entry.symlink ? ' ↗' : ''))),
          !listing.directories.length && h('p', {className: 'ds-ssh-empty'}, '此目录中没有子目录，可以直接选择当前目录。'), listing.truncated && h('p', null, '只显示前 2000 个目录，可输入完整路径继续。'))),
        h('p', {className: 'ds-ssh-muted'}, '使用本地模型和聊天，文件直接读写到远程电脑。'),
        h(Button, {primary: true, disabled: !alias || !path.trim() || op.busy, onClick: () => op.run(async (signal, extra, onChallenge) => { const workspace = await action({action: 'open', alias, path, ...(name.trim() ? {title: name.trim()} : {})}, signal, onChallenge); onPicked(workspace.localRoot); })}, '连接并创建远程工作区')),
      h(Notice, {op}),
      mode !== 'choose' && h(Button, {disabled: op.busy, onClick: () => { setName(''); setMode('choose'); }}, '返回选择')));
}
function AuthenticationRequest({pending}) {
  const op = useOperation();
  useEffect(() => { op.run((signal, secrets, onChallenge) => action({action: 'connect', alias: pending.alias, secrets}, signal, onChallenge)); }, [pending.id]);
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
  if (!pending || (activeSessionDocks.get(pending.alias) || 0) > 0) return null;
  return h(AuthenticationRequest, {key: pending.id, pending});
}
function WorkspaceConfiguration({ctx, requests}) {
  const [request, setRequest] = useState(requests.current);
  useEffect(() => { requests.listeners.add(setRequest); return () => requests.listeners.delete(setRequest); }, [requests]);
  return request ? h(WorkspaceConfigurationDialog, {key: request.workspaceId, request, close: () => requests.set(null)}) : null;
}
function WorkspaceConfigurationDialog({request, close}) {
  const [workspace, setWorkspace] = useState(null), [hosts, setHosts] = useState([]);
  const [title, setTitle] = useState(''), [alias, setAlias] = useState(''), [path, setPath] = useState('');
  const [listing, setListing] = useState(null), [connected, setConnected] = useState([]);
  const dialog = useRef(null), noticeRef = useRef(null), op = useOperation();
  useEffect(() => {
    op.run(async signal => {
      const [value, state] = await Promise.all([
        api({action: 'workspace-config', workspaceId: request.workspaceId}, signal),
        api({action: 'hosts-status'}, signal)
      ]);
      setWorkspace(value); setTitle(value.title || ''); setAlias(value.alias || ''); setPath(value.path);
      setHosts(state.hosts); setConnected(state.hosts.filter(host => host.connected).map(host => host.alias));
    });
    const previous = document.activeElement;
    dialog.current?.focus();
    return () => { if (previous?.isConnected) previous.focus?.(); };
  }, []);
  useEffect(() => {
    if (op.challenge || op.error) noticeRef.current?.scrollIntoView?.({block: 'nearest'});
  }, [op.challenge?.id, op.error]);
  const dismiss = () => { op.cancel(); close(); };
  const remote = workspace?.kind === 'remote';
  const hostChanged = remote && alias !== workspace.alias;
  const changed = workspace && (title.trim() !== (workspace.title || '') || hostChanged || path !== workspace.path);
  const online = remote && connected.includes(alias);
  const connect = remote && (hostChanged || !online);
  const browsePath = target => op.run(async (signal, _extra, onChallenge) => {
    const value = await action({action: 'browse', alias, path: target}, signal, onChallenge);
    setPath(value.path); setListing(value); setConnected(old => [...new Set([...old, alias])]);
  });
  const saveWorkspace = () => op.run(async (signal, _extra, onChallenge) => {
    if (connect) await action({action: 'connect', alias}, signal, onChallenge);
    if (changed) await action({action: 'update-workspace', workspaceId: workspace.workspaceId,
      revision: workspace.revision, title, path, ...(remote ? {alias} : {})}, signal, onChallenge);
    close();
  });
  const onKeyDown = event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); }
    if (event.key !== 'Tab') return;
    const items = [...dialog.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')];
    const first = items[0], last = items.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first?.focus(); }
  };
  return h('div', {className: 'ds-ssh-backdrop', onKeyDown},
    h('div', {className: 'ds-ssh-dialog', ref: dialog, role: 'dialog', 'aria-modal': true, 'aria-label': '工作区配置', tabIndex: -1},
      h('div', {className: 'ds-ssh-row ds-ssh-dialog-header'},
        h('h2', null, '工作区配置'), h(Button, {'aria-label': '关闭工作区配置', className: 'ds-ssh-icon-btn', onClick: dismiss}, '×')),
      workspace && h('div', {className: 'ds-ssh-stack'},
        h(Field, {label: '工作区名称', value: title, maxLength: 120, disabled: op.busy, onChange: event => setTitle(event.target.value)}),
        remote ? h(React.Fragment, null,
          h('label', {className: 'ds-ssh-field'}, h('span', null, 'SSH 主机', online && h('span', {className: 'ds-ssh-muted'}, ' · 已连接')),
            h('select', {'aria-label': 'SSH 主机', value: alias, disabled: op.busy, onChange: event => { setAlias(event.target.value); setListing(null); op.clearError(); }},
              !hosts.some(host => host.alias === alias) && h('option', {value: alias}, alias || '请选择'),
              hosts.map(host => h('option', {key: host.alias, value: host.alias}, host.alias)))),
          h('div', {className: 'ds-ssh-row'},
            h(Field, {label: '远程目录', value: path, disabled: op.busy, onChange: event => { setPath(event.target.value); setListing(null); }}),
            h(Button, {disabled: op.busy || !alias || !path.trim(), onClick: () => browsePath(path)}, '浏览')),
          listing && h('div', {className: 'ds-ssh-directory'}, h('code', null, listing.path),
            h('div', {className: 'ds-ssh-files', 'aria-label': '远程目录列表'},
              h(Button, {disabled: op.busy, onClick: () => browsePath(listing.path.slice(0, listing.path.lastIndexOf('/')) || '/')}, '↑ 上级目录'),
              listing.directories.map(entry => h(Button, {key: entry.name, disabled: op.busy,
                onClick: () => browsePath((listing.path === '/' ? '' : listing.path) + '/' + entry.name)}, '▸ ' + entry.name)),
              listing.truncated && h('p', null, '仅显示前 2000 个目录。')))) :
          h(Field, {label: '本地目录', value: path, readOnly: true})),
      h('div', {ref: noticeRef}, h(Notice, {op})),
      workspace && h('div', {className: 'ds-ssh-row'},
        h(Button, {onClick: dismiss}, '取消'),
        h(Button, {primary: true, disabled: op.busy || (!changed && !connect) || !title.trim() || !path.trim() ||
          (remote && !hosts.some(host => host.alias === alias)), onClick: saveWorkspace},
        connect ? changed ? '连接并保存' : '连接' : '保存'))));
}
function ConversationSshDock({sessionId}) {
  const [status, setStatus] = useState(null), [hosts, setHosts] = useState([]), [selectedAlias, setSelectedAlias] = useState(''), [dismissed, setDismissed] = useState(false);
  const op = useOperation();
  const startedAuthRef = useRef(null), aliasRef = useRef('');
  useEffect(() => {
    setDismissed(false); startedAuthRef.current = null; setSelectedAlias('');
    if (!sessionId) { setStatus(null); return; }
    let closed = false, timer, lastAlias = '';
    const controller = new AbortController();
    const poll = async () => {
      try {
        const next = await api({action: 'session-ssh-state', sessionId}, controller.signal);
        if (closed) return;
        setStatus(next);
        if (!next?.ssh) return;
        setSelectedAlias(old => old || next.alias);
        if (!lastAlias || lastAlias !== next.alias) {
          lastAlias = next.alias;
          api({action: 'hosts-status'}, controller.signal).then(data => { if (!closed && data?.hosts) setHosts(data.hosts); }).catch(() => {});
        }
        timer = setTimeout(poll, next.state === 'connected' && !next.auth ? 3500 : 1200);
      } catch {
        if (!closed) timer = setTimeout(poll, 3000);
      }
    };
    poll();
    return () => { closed = true; controller.abort(); clearTimeout(timer); };
  }, [sessionId]);
  useEffect(() => {
    if (status?.alias && (!selectedAlias || status.state === 'connected')) setSelectedAlias(status.alias);
  }, [status?.alias, status?.state]);
  useEffect(() => {
    const alias = status?.ssh ? status.alias : '';
    aliasRef.current = alias;
    if (!alias) return;
    activeSessionDocks.set(alias, (activeSessionDocks.get(alias) || 0) + 1);
    return () => {
      const count = (activeSessionDocks.get(alias) || 1) - 1;
      if (count <= 0) activeSessionDocks.delete(alias); else activeSessionDocks.set(alias, count);
    };
  }, [status?.ssh, status?.alias]);
  useEffect(() => {
    const auth = status?.auth;
    if (!auth || startedAuthRef.current === auth.id || op.busy) return;
    startedAuthRef.current = auth.id;
    setDismissed(false);
    op.run((signal, secrets, onChallenge) => action({action: 'connect', alias: auth.alias, secrets}, signal, onChallenge));
  }, [status?.auth?.id]);
  if (!status?.ssh) return null;
  const auth = status.auth;
  const targetAlias = selectedAlias || status.alias;
  const switchingHost = targetAlias && targetAlias !== status.alias;
  const showDetail = !!op.challenge || !!op.error || (op.busy && !op.result) || !!auth;
  if (status.state === 'connected' && !op.busy || dismissed && !op.busy && !auth) return null;
  const startConnect = () => {
    setDismissed(false);
    op.run(async (signal, secrets, onChallenge) => {
      if (switchingHost) {
        if (auth) await api({action: 'auth-cancel', id: auth.id}, signal).catch(() => {});
        const cfg = await api({action: 'workspace-config', workspaceId: status.workspaceId}, signal);
        await action({
          action: 'update-workspace',
          workspaceId: status.workspaceId,
          revision: cfg.revision,
          title: cfg.title || status.title || `SSH · ${targetAlias}`,
          path: cfg.path,
          alias: targetAlias,
          secrets
        }, signal, onChallenge);
      } else {
        await action({action: 'connect', alias: status.alias, secrets}, signal, onChallenge);
      }
      const latest = await api({action: 'session-ssh-state', sessionId}, signal);
      setStatus(latest);
      if (latest?.alias) setSelectedAlias(latest.alias);
      api({action: 'hosts-status'}, signal).then(data => { if (data?.hosts) setHosts(data.hosts); }).catch(() => {});
    });
  };
  const cancelConnect = () => {
    op.cancel();
    if (auth) api({action: 'auth-cancel', id: auth.id}).catch(() => {});
    else setDismissed(true);
  };
  const dotClass = op.error ? 'ds-ssh-dot ds-ssh-dot-err' : op.busy ? 'ds-ssh-dot ds-ssh-dot-busy' : 'ds-ssh-dot';
  return h('div', {className: 'ds-ssh-dock', role: 'region', 'aria-label': 'SSH 连接提示'},
    h('div', {className: 'ds-ssh-dock-bar'},
      h('span', {className: dotClass, 'aria-hidden': true}),
      h('span', {className: 'ds-ssh-dock-title'}, auth ? 'SSH 需认证' : op.busy ? 'SSH 连接中' : op.error ? 'SSH 连接失败' : 'SSH 未连接'),
      hosts.length > 1
        ? h('select', {className: 'ds-ssh-dock-select', 'aria-label': 'SSH 连接主机', value: targetAlias, disabled: op.busy, onChange: e => { op.clearError(); setSelectedAlias(e.target.value); }},
            hosts.map(item => h('option', {key: item.alias, value: item.alias}, `${item.alias} (${item.hostname})`)))
        : h('span', {className: 'ds-ssh-dock-host'}, status.alias),
      h('div', {className: 'ds-ssh-dock-actions'},
        (!op.busy || op.error) && h(Button, {primary: true, onClick: startConnect}, switchingHost ? '切换并连接' : op.error ? '重试' : '连接'),
        op.busy || auth
          ? h(Button, {onClick: cancelConnect}, '取消')
          : h(Button, {'aria-label': '收起 SSH 提示', className: 'ds-ssh-icon-btn', onClick: () => setDismissed(true)}, '×'))),
    showDetail && h('div', {className: 'ds-ssh-dock-body'}, h(Notice, {op, compact: true, cancel: cancelConnect})));
}
function apply(ctx) {
  const requests = {current: null, listeners: new Set(), set(value) { this.current = value; for (const listener of this.listeners) listener(value); }};
  ctx.effect(() => ctx.contextMenus.register({id: `${ID}.workspace-config`, target: 'workspace', order: 150, resolve: value => [{id: 'configure', label: '工作区配置', icon: {key: 'workspace.rename'}, run: () => requests.set(value)}]}));
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({name: 'shell.overlay', id: `${ID}.workspace-config`, order: 91, inject: () => ({ctx, requests})}, WorkspaceConfiguration));
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({name: 'conversation.input.dock', id: ID, order: 15, inject: sessionId => ({sessionId, requests})}, ConversationSshDock));
  ctx.effect(() => { const style = document.createElement('style'); style.dataset.plugin = ID; style.textContent = CSS; document.head.appendChild(style); return () => { style.remove(); }; });
  ctx.slots.inject('settings.section', () => ctx.slots.register({name: 'settings.section', id: ID, order: 35, label: () => 'SSH 远程工作区', inject: () => ({ctx})}, Settings));
  for (const name of ['sidebar.workspaces.directoryFlow', 'conversation.hero.workspace.directoryFlow', 'workspace.picker.directoryFlow']) ctx.slots.inject(name, () => ctx.slots.register({name, priority: -100, inject: () => ({ctx})}, WorkspaceFlow));
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({name: 'shell.overlay', id: ID, order: 90}, ConnectionAuthentication));
  ctx.inject(['sidebarRight'], scope => scope.effect(() => {
    // Close only this plugin's obsolete 0.2.0 tabs as their sessions are adopted.
    const migrate = () => {for (const tab of scope.sidebarRight.openTabs.getSnapshot()) if (tab.kind === 'ssh-files') scope.sidebarRight.closeIn(tab.sessionId, tab.tabId);};
    const timer = setInterval(migrate, 1000); migrate();
    return () => clearInterval(timer);
  }));
}

return {apply,inject};
}});

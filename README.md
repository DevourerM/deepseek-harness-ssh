# DSH SSH 远程文件夹

把远程文件夹加入**本地 DSH** 的工作区列表。本地模型和账号通过 SSH 直接读取、写入、编辑远程文件，在远程目录执行命令；聊天、模型设置与会话保存在本机。

0.4.0 使用本地 Host 架构。远端只需要 **SSH、SFTP、POSIX 环境与 Python 3**，无需配置模型账号、安装 DSH、Node 或 npm。已实机验证 Windows 本机 + Rocky Linux 9 远端、DSH **0.2.1-rc.3**。其他宿主版本和 macOS 远端尚未实机验证。

0.4.0 接入原有右侧栏的**新建终端**。SSH 工作区会列出服务器的 Shell，在远程当前目录启动 Linux PTY，支持交互输入、中文、窗口缩放、Ctrl+C、退出码和关闭时的进程清理，修复远端目录被交给 Windows 本机 Shell 导致的退出码 267。终端需要 Linux `/proc`、Python 标准库与可用的交互 Shell。

0.3.1 修复 Windows 本机创建 SSH 子智能体时，远程目录被宿主转成带盘符路径，导致“SSH 工作区只接受远端 POSIX 路径”的问题。支持 spawn、fork、嵌套子智能体，以及当前目录继承、相对目录和显式远程目录；原生权限与真正本机路径的拒绝规则保持生效。

## 安装与配置

1. 打开 DSH **插件 → 添加插件**，在“包名或地址”填写安装包绝对路径：

   ```text
   D:\code\dsh-plugin\deepseek-harness-ssh\dist\deepseek-harness-ssh-0.4.0.tgz
   ```

2. 安装并选择 **立即启用**，按宿主提示重启。
3. 打开 **设置 → SSH 远程工作区**，保存独立配置并点击 **检查连接**：

   ```sshconfig
   Host my-server
     HostName 192.168.1.20
     User developer
     Port 22
     IdentityFile ~/.ssh/id_ed25519

   Host bastion
     HostName gateway.example.com
     User developer
     IdentityAgent default

   Host private-server
     HostName 10.0.0.20
     User developer
     ProxyJump bastion

   Host *
     ConnectTimeout 15
     ServerAliveInterval 15
   ```

首次连接需要核对 SHA256 主机指纹。缺少登录密码或加密私钥口令时会弹出输入框，提交后继续原操作；错误密码可以重输。密码只用于当前连接，不写入配置或浏览器持久存储。断线后自动尝试密钥认证，必要时在本地窗口重新提示密码；也可以取消连接。跳板机使用独立凭据。支持单个密码提示的 keyboard-interactive；多轮验证码/MFA 尚不支持。

配置位于 `%USERPROFILE%\.dsh\plugins\deepseek-harness-ssh\config`，或 `$DSH_HOME/plugins/deepseek-harness-ssh/config`。配置与主机指纹库独立于 VS Code 和 OpenSSH 配置。可以引用已有私钥；不会转发 SSH Agent。支持上述指令、`IdentityAgent none`、引号、注释、`Key=Value` 与 `Host *` 默认值。出于兼容性仍接受旧的 `NodePath` 字段，当前版本不使用它。拒绝 Include、ProxyCommand 和任意本地命令。

## 使用远程文件夹

1. 点击 **添加工作区**，选择 **远程文件夹 · SSH**。
2. 选择主机，浏览或输入远程目录，例如 `~/project`。
3. 点击 **连接并创建远程工作区**，本地工作区列表出现 `SSH · 主机 · 目录`。
4. 继续使用本地现有模型聊天。原生 `read`、`write`、`edit` 直接操作远程文件，`glob`、`grep` 使用远程 Python 搜索，命令使用 `ssh_exec`。
5. 右侧栏打开原有的 **文件** 即可浏览、预览和编辑远程文件。兼容现有 dsh-better-sidebar，无需切换到额外入口。
6. 点击原有的 **新建终端**，在远程当前目录打开服务器的交互 Shell；Shell 菜单使用服务器可用项，本地工作区仍使用本机终端。

文件更改直接发生在服务器，支持中文、空格、版本冲突保护和原子替换。文件树通过远程目录观察自动刷新，也可使用现有刷新按钮。搜索跳过隐藏目录、`node_modules`、`__pycache__`，最多扫描 10000 个文件、返回 1000 条结果；内容搜索使用 Python 正则，跳过超过 2 MiB 的文件，不解析 `.gitignore`。

默认权限由本地 DSH 管理：只读模式拒绝直接写入，工作区写入模式检查远端规范路径及软链接边界。`ssh_exec` 的远程 Shell 不受本机操作系统沙箱约束，因此非完全访问模式下每次命令走 DSH 原生审批；完全访问模式按用户所选权限执行。远端命令不会退回本地 PowerShell。

侧栏终端沿用 DSH 原有的用户终端权限语义：用户输入按服务器账号权限执行，不受模型文件工具的工作区沙箱约束。界面刷新或重连保留 Host 上已建立的终端。关闭标签页时清理该 PTY 会话内仍运行的进程；SSH 连接丢失后交互进程不自动恢复，新建终端会重连，必要时继续使用既有密码提示。活动观察不推测 Shell 已空闲，无法确认时返回 unknown。

## 兼容边界

DSH 的工作区注册硬编码本机路径，因此本机保留一个空的身份目录和持久映射，接入原生工作区列表；项目文件不会复制或同步到该目录。插件只对已登记的 SSH 工作区路由文件系统与进程操作，普通本地工作区继续使用原实现。卸载插件不会删除服务器文件。

- 已验证原生模型工具、工作区创建、会话、文件树/预览、本地模型设置和原生命令审批，以及 spawn/fork 和嵌套子智能体的远程原生文件读写。
- 已接入 `dsh-better-sidebar 0.28.0` 原有文件页：目录树、搜索、文本编辑保存、保存冲突检测、新建/重命名/删除、上传下载、媒体读取及目录自动刷新。请求按会话路由，切回本地工作区仍调用原插件的本地实现。没有新增“SSH 文件”卡片。其 Git 页仍未接入远端，远程 Git 请使用 `ssh_exec`。
- 原有侧栏交互终端已在 Linux 远端验证，支持前台中断、后台进程清理、SSH 通道结束清理与退出状态。主动创建新会话（setsid）或脱离会话的守护进程不属于该 PTY 的会话清理范围；远程 Shell 不使用本机系统沙箱。
- 依赖本机暂存目录的 Git 快照暂不支持 SSH 工作区。可使用远程终端或 `ssh_exec` 执行远程 Git、构建和其他命令。
- 目前不支持远端 Windows、会话在本地/远程之间迁移、远程端口转发 UI，以及任意依赖本地磁盘路径的第三方插件。
- 0.1.x 的远程 Host 会话不会自动迁入本机会话。0.3.0 不再启动远端 DSH，旧版本遗留的远端运行时文件保留，当前功能不依赖它们。

## 开发与验证

```powershell
npm ci --ignore-scripts --omit=optional
npm run build
npm test
npm run test:host
npm run test:ui
# 有实际 SSH 配置及已安装 better-sidebar 时：npm run test:files
npm run test:terminal
npm run test:terminal-ui
npm run pack:plugin
npm run test:install
```

宿主测试需要 DSH 0.2.1-rc.3 运行时，通过 `DSH_DEV_RUNTIME` 指定其 `node_modules`。UI 测试需要 `SSH_PLAYWRIGHT` 指向 Playwright 的 `index.mjs`，可选 `SSH_CHROMIUM`。`npm run test:remote` 读取本机忽略的 `artifacts/real-server/config` 与独立主机指纹，在服务器专用验证目录运行本地模拟模型及真实 SSH 文件测试，不请求外部模型。

远程文件页支持 UTF-8 文本编辑（保留 BOM 和 CRLF），超过 5 MiB 的文本分页只读；上传与保存上限 8 MiB，单次媒体读取/下载上限 16 MiB。非 UTF-8 文件不会按 UTF-8 覆写。文件页受当前会话权限及远端工作区路径边界约束。

安装包包含构建产物与纯 JavaScript SSH/WebSocket 依赖。`node scripts/install-desktop.mjs` 可更新本机 Desktop profile，保留模型设置和其他插件，并备份清单与旧插件。详见 [实现计划](docs/PLAN.md) 和 [验证记录](docs/VALIDATION.md)。本项目使用独立 Git 仓库，MIT License。

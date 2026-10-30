# 0.4.1 宿主兼容验证（2026-10-30）

环境：Windows、本地 Node 24.17.0；桌面端已升级到官方 DSH **0.2.1-rc.5**（`resources/app.asar` 内 `@deepseek-ai/dsh-desktop` 与自带 CLI 均为 0.2.1-rc.5）。测试使用从 app.asar 解出的官方 rc.5 运行时 `../tree-chat/research/compat-0.2.1-rc.5/dsh/node_modules`（gitignored，`@deepseek-ai/dsh/lib/bin.js --version` 为 0.2.1-rc.5）；rc.3 运行时保留作为回退。未安装到真实 `%USERPROFILE%\.dsh` profile，未修改或重启正在运行的桌面应用。

- 宿主兼容性：`@deepseek-ai/dsh-fs`、`@deepseek-ai/dsh-tools` 的 peerDependencies 从精确 `0.2.1-rc.3` 改为 `>=0.2.0-rc.2 <0.3.0 || 0.2.1-rc.2 || 0.2.1-rc.3 || 0.2.1-rc.5`；`package-lock.json` 镜像字段同步。直接调用 rc.5 运行时的 `evaluatePluginCompatibility`：旧范围对 0.2.1-rc.5 返回未满足要求，新范围对 0.2.1-rc.5 与 0.2.1-rc.3 均返回兼容（`undefined`）。未添加 `engines.dsh`。
- `npm run build`：通过，`lib/` 由 `src/` 重新生成。
- `npm test`：**32 项通过、0 失败**。
- `npm run test:host`（不设置 `DSH_DEV_RUNTIME`，默认解析 rc.5 运行时）：通过；宿主日志无 “incompatible / skipping profile bundle” 或模块解析失败；配置 API 鉴权、保存、版本冲突、无效配置拒绝均通过。结果 `artifacts/host-result.json` 记录 `"host": "0.2.1-rc.5"`。
- `npm run pack:plugin`：通过；生成 `dist/deepseek-harness-ssh-0.4.1.tgz`（228 个条目，6 个 bundled 纯 JS SSH 依赖）。最终 tgz 的 `sha256` 由 `pack.mjs` 写入 `dist/checksums.json` 并随任务报告提交；本文件本身随发行包分发，因此不在正文内嵌自身压缩包的哈希。
- `npm run test:install`（真实 Plugins UI，隔离 DSH_HOME + rc.5 运行时 + 系统 Chrome）：通过。tgz 经真实界面安装并点击“立即启用”，`profiles/web/node_modules/deepseek-harness-ssh` 版本 0.4.1；启用后 `POST /api/dsh-ssh {action:'config'}` 返回 200（证明 Host 入口真实激活，而非仅出现设置页），SSH 设置页可见，浏览器无页面错误，宿主日志无兼容性/激活警告。结果 `artifacts/install-result.json` 记录 `"host": "0.2.1-rc.5"`、`hostActive: true`。
- 版本记录：`scripts/env.mjs` 默认解析 `research/compat-0.2.1-rc.5/dsh/node_modules` 并回退 rc.3；`host-smoke.mjs`、`ui-install.mjs`、`ui-smoke.mjs` 不再硬编码宿主版本，改为读取运行时 `@deepseek-ai/dsh/package.json` 的 `version`。
- 隔离安装测试根因修复：此前把 DSH_HOME 放在插件仓库 `artifacts/` 下时，profile 位于本仓库包目录内，Node 的包自引用（self-reference，仓库 `package.json` 的 name 即 `deepseek-harness-ssh`）会让 HMR 重新加载插件时把裸包名解析回本仓库 `lib/index.js`，产生 `Cannot find package '@deepseek-ai/dsh-fs' imported from D:\...\deepseek-harness-ssh\lib\host\processes.js`。真实用户 DSH_HOME 不在插件包内，不会触发；测试已把隔离 home 移到系统临时目录，并新增“Host API 返回 200 / 无激活警告”断言，避免设置页出现即误判通过。
- 旧版远端 Host 协议常量：`src/host/remote.js` 的 `RUNTIME_VERSION` 保持 `0.2.1-rc.3`，不改。该文件与 `manager.js`、`gateway.js` 属于 0.1.x 远端 Host 架构，`scripts/build.mjs`/`pack.mjs` 明确不把它们放进 `lib/` 或发行包（pack 断言不存在），`test/integration-fixture.mjs` 与 `ssh.test.mjs` 中的假远端版本也保持 rc.3；本机 Host 架构（0.4.x）不依赖远端 DSH 运行时，修改它只会制造未经验证的远端部署声明。`scripts/diagnose-server.mjs`、`verify-server.mjs`、`probe-server.mjs` 是可选真实服务器脚本，仍指向服务器上已部署的 rc.3 运行时。
- 跳过项：需要真实远端 SSH 服务器的可选套件（`test:remote`、`test:files`、`test:terminal`、`test:terminal-ui`、`test:subagent`、`native-smoke`）本次未重跑。它们是 0.4.0 发布的既有验证记录，本次变更只涉及宿主 peer 范围与验证脚本，宿主侧 rc.5 包与 rc.3 除版本字符串外一致；服务器当前可达（`ssh ... echo SSH_OK` 通过），但按要求不作为 0.4.1 的通过条件，也不把旧记录当作本轮结果。

# 0.4.0 新增验证（2026-10-27）

- `npm test`（32 项通过）：新增终端分片数据/中文传输、输入/缩放/前台信号、关闭等待远端退出、断线拒绝未完成操作与保守活动状态，以及原生终端的远程 Shell/目录作用域、本机透传和卸载恢复。
- `npm run test:terminal`：真实 Linux SSH PTY 验证 tty 与远程工作目录、中文输入、实际远程文件写入、`stty size` 缩放、前台 sleep 中断、后台进程关闭清理、显式退出码 7、SSH 输入流结束时清理；创建请求的 signal 结束不影响已建立的终端。
- `npm run test:terminal-ui`：独立 DSH 0.2.1-rc.3 profile、原有右侧栏终端组件、实际 better-sidebar 同时启用，通过真实界面新建终端和键盘输入，在服务器验证文件落地；页面刷新重连后同一终端继续在远程目录写入，浏览器缩放后仍可操作，原组件正确显示退出码 7，本机身份目录保持空，浏览器无错误。
- 新包仅保存在项目 dist，用户当前安装保持 0.3.1，不执行导入、更新或重启。

# 0.3.1 既有验证（2026-10-27）

- `npm test`（29 项通过）：新增 Windows 路径转换回归、默认/已变更/相对/显式/映射目录、嵌套子智能体、Windows/UNC/其他 SSH 身份目录拒绝、取消、本地委派透传、卸载恢复，以及原生生命周期持有前不异步等待。
- `npm run test:subagent`：独立 DSH 0.2.1-rc.3 profile + 确定性本地模型 + 真实 Linux SSH 服务器，实际创建 spawn/fork 与嵌套子智能体；验证七种目录情形，原生 write/read 的结果真实位于服务器，本机身份目录为空，原生子会话权限与父子元数据保留。真正本机路径在创建前被拒绝。
- `npm run pack:plugin`：生成 0.3.1 软件安装包并检查新子智能体适配模块进入发行包。
- 本次不更新或重启用户正在使用的 DSH；桌面继续使用已安装的 0.3.0。测试使用单独的 profile、端口、确定性本地模型及远端专用验证目录。

# 0.3.0 既有验证记录

环境：Windows、本地 Node 24.17、DSH 0.2.1-rc.3、真实 Rocky Linux 9 SSH 服务器（Python 3.9）。连接资料、服务器路径和凭据不提交 Git；验证产物在忽略目录 artifacts/。

- `npm test`（25 项通过）：独立配置、信任与指纹变化、真实 SSH/SFTP、密码缺失/错误、加密私钥、keyboard-interactive 与验证码拒绝、跳板机；工作区路径/并发隔离、适配器卸载恢复、密码断线重连和取消。历史 0.1.x 测试保留作回归，其远程 Host 模块不再进入发行包。
- `npm run test:host`：真实本地 DSH Host 加载插件、原生 API 认证、配置保存、版本冲突及无效输入拒绝。
- `npm run test:ui`：真实 Host + 浏览器 + 本机加密 SSH/SFTP；首次指纹确认、自动密码表单、错误密码重试、中文空格目录、本地目录创建。此测试以 Node 夹具代替 POSIX Python 探测；Python 文件执行另在真实服务器验证。
- `npm run test:remote`：通过实际 SSH 在专用验证目录测试原子创建/编辑、冲突版本、只读、中文空格和软链接边界。本机测试模型通过本地 DSH 的原生 write/read/edit 修改远程文件，通过 glob/grep 搜索，通过 ssh_exec 在远端运行 pwd/cat；点击本地原生审批后继续。验证原生文件预览、本机身份目录为空、浏览器没有 iframe、全程同一个本地 Host。过程不调用外部模型、不在远端配置账号。
- `npm run test:files`：真实服务器 + 实际 better-sidebar 0.28.0 组件，原文件页目录树、原编辑器保存、WebSocket 目录自动刷新、保存冲突、中文目录及新建/重命名/删除、二进制上传下载、认证/Origin 拒绝与工作区边界；切换本地工作区后原文件页仍正确读取本机文件，额外 SSH 文件入口不存在。
- `npm run pack:plugin`：检查标准 DSH bundle/client 元数据、Python 辅助脚本及完整纯 JS SSH 依赖，检查发行包不含旧网关、远端 DSH 启动器、个人路径或验证产物。
- `npm run test:install`：真实 DSH 插件界面安装 tgz、立即启用、SSH 设置页出现。
- `node scripts/native-smoke.mjs`：本机实际 DSH 桌面验证，检查连接成功，远程主目录进入本地工作区列表；本地模型选择保持原值，现有 better-sidebar 同时启用，原有“文件”页成功预览远端验证文件，全程无 iframe。命令超时终止也已在实际服务器验证。

完整测试结果以当前 artifacts/*-result.json 为准。macOS/Windows 远端、多轮 MFA 及其他未适配第三方文件 API 未作兼容承诺；原生交互终端在 0.4.0 单独完成 Linux 验证。远程 Shell 使用服务器用户的真实系统权限，未宣称受到本机操作系统沙箱限制。

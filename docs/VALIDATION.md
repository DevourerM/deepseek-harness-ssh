# 0.3.1 新增验证（2026-10-27）

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

完整测试结果以当前 artifacts/*-result.json 为准。macOS/Windows 远端、多轮 MFA、原生交互终端及其他未适配第三方文件 API 未作兼容承诺。远程 Shell 使用服务器用户的真实系统权限，未宣称受到本机操作系统沙箱限制。

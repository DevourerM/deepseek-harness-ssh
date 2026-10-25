# SSH 工作区实现计划

## 宿主边界与方案

研究对象：DSH 0.2.1-rc.3（本机合法安装运行时）。`dsh-workspace` 的 create/attachSession 直接调用本地 fs.realpath/stat，无法以纯插件注册 ssh:// 路径。替换全局 fs 也无法覆盖工作区注册、原生侧栏和终端的所有本地调用。

采用官方 SSH 使用方式的插件化实现：远端 DSH Web Host + SSH 加密端口转发 + 桌面内远程视图。远端原生文件侧栏、预览、终端、工具、审批全部由远端 Host 提供。远程会话与模型凭据归远端，不把本机模型密钥自动传过去。保留本机 Host、在顶栏返回本地；远程工作区连接由插件设置页管理。

参考：官方 https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/web-app/README.md 和本机版本启动参数实现。新建目录选择使用公开的 single Slot 优先级覆盖，卸载后由原生选择器继续接管。

## 实现顺序

1. 独立 OpenSSH 风格配置解析、校验、原子保存；独立主机指纹，显式首次信任；密码/密钥口令仅留内存。
2. SSH 真协议客户端、超时、SFTP 目录浏览、Agent/私钥/临时密码认证和跳板机。
3. 连接检查：SSH、SFTP、Node 版本、远端 DSH 安装与版本；明确操作安装固定版本的远端运行时。
4. 远端 Host 管理：目录校验、独立 DSH_HOME、初始化工作区、解析启动 URL、仅绑定回环、隧道、断线与清理。
5. 设置 SSH 栏、新建本地/远程窗口、目录浏览、远程视图、返回本地与重新连接。
6. 真 SSH/SFTP/转发本地夹具测试，故障/主机指纹/路径注入测试；隔离真实 DSH Host 的安装和 UI 验证；生成可在软件安装的自包含 tgz。

## 范围与验收

- 首版远端系统为 Linux/macOS，要求 POSIX shell、Node >=22、SFTP 与 TCP 转发；本机 Windows。远端 Windows shell 不冒充兼容。
- 独立配置位于 DSH_HOME/plugins/deepseek-harness-ssh，不读写 ~/.ssh/config 或 VS Code 配置；私钥可引用已有文件，Agent 不转发。
- 断线不回落到本地执行；保持远端数据，重连重新启动 Host。禁用/卸载释放监听器、SSH、隧道与受管 Host。
- 未使用真实外部电脑的结果必须在验证文档中说明，区分真 SSH 本机夹具、真实 DSH 与无法覆盖的真实服务器差异。
- Git 使用独立仓库与 codex/ssh-workspaces 分支；计划、实现、测试分阶段提交；不自动推送或发布。

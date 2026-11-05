# 更新日志

## 1.0.1

仓库整理与文档修订，**插件行为无变化**。

- 工作区收拢：开发脚本、asar 解包产物、npm 登录脚本移入 `_recon/`，并加入 `.gitignore`，不再进任何发布产物。
- `PUBLISH.md` 补记实测坑：沙箱内 Git for Windows 的 cygwin `ssh.exe` 会因无法创建命名管道而失败（`couldn't create signal pipe, Win32 error 5`），改用 `GIT_SSH="C:/Windows/System32/OpenSSH/ssh.exe"` 可绕开（`GIT_SSH_COMMAND` 仍走 sh，无效）。
- 无 `lib/`、`cordis.patch.yml` 改动，升级无需改配置。

## 1.0.0

首个正式版（由 dsh-clarify 更名而来）。

- 更名：插件 id `dsh-clarify` → `dsh-thinking-review`，包名、路由前缀、状态文件名同步。
- 兼容：新状态文件不存在时回退读取 `$DSH_HOME/dsh-clarify/state.json`，下一次写入自动迁移。
- 追问逻辑重写为七条判据（信息价值为零、先找决策、至少 3 种合理解读、只在做法分岔处问、答前只读侦察、答前复述与推翻条件、交付带边界、叫停即开工），删掉旧的六维与 SPIDR 拆片规则。
- 新增诊断路由 `GET /dsh-thinking-review/text`。
- 测试：Host 半 8 条判据断言 + 挂载/卸载/重启幂等；客户端半 slot 注册与指令投递。

## 0.2.0

- 按《高阶思维：核验、修正与重构》重写 "追问澄清" 提示词（七条判据）。
- 新增 `/text` 诊断路由。

## 0.1.0

- 首版 `dsh-clarify`：per-session 追问澄清开关 + 会话复盘写入长期记忆。

# 更新日志

## 1.0.2

修复：对话输入框上方的两个按钮（追问澄清 / 复盘本会话）完全不显示。

- 根因：`lib/client.js` 里 `slots.register({ name })` 的 `name` 写成了插件名 `dsh-thinking-review`。该字段是**槽位键**，必须是 `conversation.input.dock`；写错会让 slots 立即抛出 `slot "dsh-thinking-review" is not declared (a parent entry's children table must declare it)`，客户端 `apply()` 整体失败，页面只留一个空的 `data-slot-error` 节点，所以视觉上等于"没有按钮"。
- 槽位键收成常量 `SLOT`，`register` 失败时打 `console.error`（此前完全静默）。
- `inject` 由 `['slots', 'sessions']` 收为 `['slots']`：`sessions` 只在点击时通过 `ctx.get('sessions')` 取，避免"等服务"导致 entry 永不激活。
- 无 Host 半改动；升到 1.0.2 后刷新页面即可。

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

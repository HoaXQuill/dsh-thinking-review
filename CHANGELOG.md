# 更新日志

## 1.2.1

追问提示词补「提问后停住」：没回应就等，别自己往前走。

- 新增第九条：问题发出即结束这一轮，不写代码、不改文件、不预先执行、不自己填默认值。用户一直不回就保持等待——不把沉默当成同意，也不反复追问（同一轮问题只发一次）。
- 新增第十条：带超时的交互问询，超时只表示没收到答案，不表示同意，也不表示要换默认值；仍停住等，并说明在等哪几条。
- 原九至十一条顺延为十一至十三条（答案到了复述 spec / 交付边界 / 叫停即开工）。提示词 1653 → 1882 字。

## 1.2.0

追问提示词加「工具盘查」：先确认这件事要用的工具在不在，再问用户装不装。

- 新增第三条：把需要的 CLI / 插件 / MCP / skill 列出来，对照手头工具清单与技能目录逐项确认「有 / 没有」；要真查（package.json、配置、技能目录，必要时联网搜现成插件或 CLI），不凭印象。
- 新增第四条：缺的那个非它不可时，把它做成提问里的一条——工具名 + 用途 + 为什么现有工具替代不了 + 装的代价（联网 / 装包 / 权限 / 体积 / 重启），问「装 / 换替代 / 先不做」；能手拼的小步骤不推销安装。
- 新增第五条：同意就装（能装项目本地就不装全局），装完立刻做最小可用验证并贴结果；装失败说清卡在哪一步，不许假装装好了。不装或装不了 → 替代方案（现有工具组合 / 降级交付 / 换实现），并把「因为缺 X，所以改成 Y」写进复述与边界行。
- 后续条目顺延重编号（三→六 … 八→十一）；提示词 1203 → 1653 字。

## 1.1.0

新增：左侧导航一栏 **复盘经验**，把每次「复盘本会话」的产出存档，不用再翻对话记录。

- Host 半订阅 `session/event`（`{ global: true }`）：`assistant/message` 里的 text 块按会话攒进 pending，`turn/end` 时正文 ≥ 160 字就落成一条记录并写 `$DSH_HOME/dsh-thinking-review/reviews.json`（上限 500 条）；pending 15 分钟过期。
- 只有先 `POST /reviews/request` 登记过的会话才会被收——平时聊天不进列表。
- 新路由：`/reviews/request`、`/reviews`（列表）、`/reviews/item`（全文）、`/reviews/delete`。
- 追问提示词补一张**「不清晰」清单**（10 个面：目标 / 交付物与格式 / 验收标准 / 范围与不做 / 约束 / 环境与权限 / 数据与来源 / 时间与优先级 / 可逆性 / 既有约定）：任一面答不上来且答案会改变做法，DSH 就主动提问；能查到的先查，按「答错代价 × 不确定性」挑 1–3 条问。提示词 679 → 1203 字。
- 客户端半新增两处注册：`sidebar.panellist`（id `review-notes`，label「复盘经验」，图标带 `data-dsh-panel-entry`）与 `main`（key 同为 `review-notes`）。页面支持展开 / 复制 / 删除（两次确认）/ 刷新，并有空态说明。
- 点「复盘本会话」时先登记再发指令；提示文案改成「产出会收进『复盘经验』」。
- 已知限制：1.1.0 之前的复盘没有捕获，不会补录；老会话标题读不到时显示会话 id 前 8 位。

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

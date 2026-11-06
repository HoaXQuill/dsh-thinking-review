# dsh-thinking-review · 先想清楚，再复盘

DSH 插件，三件事：

1. **追问澄清**（per-session 开关）：开了以后，DSH 遇到需求含糊时先问清再动手；它只问「答案不同、做法就不同」的问题，问完给一句复述与推翻条件，然后直接做。
2. **复盘本会话**（按钮）：把这一轮问答、结论、成功经验整理成四块，再单独问你是否写入长期记忆；你同意哪几步，才写哪几步。
3. **复盘经验**（左侧导航新一栏）：每次复盘自动存档，不用再翻对话记录。

## 分类

| 项 | 值 |
| --- | --- |
| 类型 | 对话增强 / 记忆 |
| GitHub topics | `dsh` `dsh-plugin` `thinking` `review` `clarify` `memory` `cordis` |
| 依赖 | DSH 桌面端（web 客户端半）、cordis 插件树、Node ≥ 20 |
| 版本 | 1.2.1 |
| 仓库 | https://github.com/HoaXQuill/dsh-thinking-review |

## 安装

### 从 GitHub（无需 npm）

```bash
dsh plugin add github:HoaXQuill/dsh-thinking-review
```

### 从 npm（发布后）

```bash
dsh plugin add dsh-thinking-review
```

或在桌面端「插件市场」里搜 **dsh-thinking-review** 安装，然后重启 DSH。

### 从本地目录（开发时）

```bash
dsh plugin add file:C:/Users/HoaXQ/Desktop/插件/dsh-thinking-review
```

等价于在 profile 的 `package.json` 里加：

```json
{
  "dependencies": { "dsh-thinking-review": "file:C:/Users/HoaXQ/Desktop/插件/dsh-thinking-review" },
  "dsh": { "profile": { "bundles": ["dsh-thinking-review"] } }
}
```

插件由 `cordis.patch.yml` 插入插件树；Host 半与客户端半由包内 `exports` 自动发现：

| 字段 | 作用 |
| --- | --- |
| `main` / `exports["."]` | Host 半：`lib/index.js` |
| `exports["./client"]` | 客户端半：`lib/client.js`（`dsh.client.platform = "web"`） |
| `dsh.bundle.patch` | 插件树补丁：`cordis.patch.yml` |

## 用起来

对话输入框下面多一行：

- `[● 追问澄清：开/关]` —— 只对本会话生效，状态存 `$DSH_HOME/dsh-thinking-review/state.json`，刷新页面、重启 DSH 都还在。
- `[复盘本会话]` —— 点一下会向当前会话发一条复盘指令（不发到别的会话，也不改你的草稿）。

### 追问逻辑（为什么这么问）

判据来自《高阶思维：核验、修正与重构》，核心一句：**追问只为降低做错概率**。

- **信息价值为零就不问**：如果所有可能答案都指向同一个做法，问了也不改变行动，直接做。
- **先找决策**：这次请求改变的是哪个决定或交付物？说不出，就是没听懂——那是最该问的一条。
- **问了就停住等**：问题发出即结束这一轮，不写代码、不改文件、不自己填默认值往下走。用户一直不回就一直等——沉默不等于同意，也不反复催问（同一轮问题只发一次）。带超时的问询卡超时≠同意，仍然停住等。只有用户明确说「按默认 / 别问了 / 直接做」才开工，并把采用的假设列出来。
- **先盘工具，再问装不装**：把这件事要用的 CLI / 插件 / MCP / skill 列出来，对照手头工具清单逐项确认有没有（真去查 package.json、配置、技能目录，必要时联网搜）。缺的那个非它不可，就在提问里加一条：工具名 + 用途 + 为什么替代不了 + 装的代价（联网 / 装包 / 权限 / 体积 / 重启），问「装 / 换替代 / 先不做」。同意就装，装到项目本地优先，装完立刻最小验证并贴结果；装失败说清卡在哪，不许假装装好了。不装或装不了 → 给替代方案：现有工具组合绕过 / 降级交付 / 换实现，并把「因为缺 X，所以改成 Y」写进复述和边界行。能手拼的步骤不推销安装。
- **先扫十个「不清晰」面**：目标 / 交付物与格式 / 验收标准 / 范围与不做 / 约束 / 环境与权限 / 数据与来源 / 时间与优先级 / 可逆性 / 既有约定。哪一面答不上来、且答案会改变做法，就**主动提问**；能读文件查到的先自己查。问的时候按「答错的代价 × 不确定性」挑 1–3 条。
- **至少 3 种合理解读**：包括「用户没说全，是我信息不足」，每种都给一条能区分彼此的预测。
- **只在做法分岔处提问**：分岔小于「改一句措辞」不问。问题 1–3 个（上限 5），编号、带默认值、允许一句「回 defaults」。
- **答前只读侦察**：不边问边答、不自问自答、不给最终方案。
- **答前复述**：1–3 句 spec + 「什么会让你改主意」，然后再开工。
- **交付带边界**：一行写清适用范围与推翻条件。
- **叫停即开工**：你说「别问了 / 直接做 / 停」，马上停，编号列出假设与边界。

子代理会话不挂这段提示词。

### 复盘产出

点「复盘本会话」会得到四块：

1. 会话摘要（做了什么、结论是什么）
2. 结论与决定（含被否决的方案与原因）
3. 成功经验（可复用的做法，写清适用条件）
4. 候选长期记忆 3–8 条（每条一句，可直接 `remember`）

最后单独一行问：**全部写入 / 只写入第几条 / 不要**。你明确同意后才逐条写；「不要」就停，不反复劝。

### 复盘经验（左侧导航）

左侧导航多一行 **复盘经验**，点开是本机所有复盘记录的存档：

- 每条显示：时间、会话标题（拿不到标题就显示会话 id 前 8 位）、字数、摘要。
- **展开**看全文，**复制**一键复制（可再次粘到别处），**删除**要点两次确认。
- **刷新**重读列表；列表来自 Host 的 `$DSH_HOME/dsh-thinking-review/reviews.json`，重启不丢。

怎么进去的：点「复盘本会话」时，浏览器半边先 `POST /reviews/request` 登记这一轮，Host 订阅 `session/event`，把这一轮 `assistant/message` 的正文攒起来，`turn/end` 时若正文 ≥ 160 字就落库成一条。**只有点过复盘的那一轮会被收**；平时聊天不会进列表。没等到回复超过 15 分钟自动放弃。

已知限制：

- 只有装了 1.1.0 之后产生的复盘才会进列表（之前的没有捕获，不会补录）。
- 老会话的标题读不到（DSH 只对加载过的会话给标题），显示会话 id 前 8 位。
- 列表最多 500 条，超出丢最旧的。

## HTTP 接口

Host 半注册在 `/dsh-thinking-review`：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/dsh-thinking-review/state?session=<id>` | `{ok, session, enabled}` |
| POST | `/dsh-thinking-review/state` | body `{session, enabled}`，写入并立即挂载/卸载 |
| GET | `/dsh-thinking-review/text` | 当前进程实际生效的提示词（诊断用） |
| GET | `/dsh-thinking-review/mounted` | 已挂载的会话列表、状态文件路径、复盘条数 |
| POST | `/dsh-thinking-review/reviews/request` | body `{session}`，登记「这一轮要收进复盘」 |
| GET | `/dsh-thinking-review/reviews` | 复盘列表（不含全文），附正在等待的会话 |
| GET | `/dsh-thinking-review/reviews/item?id=` | 单条复盘全文 |
| POST | `/dsh-thinking-review/reviews/delete` | body `{id}`，删一条 |

## 开发

```bash
node test/smoke.mjs        # Host 半：路由、挂载、卸载、判据关键字
node test/client-smoke.cjs # 客户端半：slot 注册、按钮、指令落到会话
node test/smoke.mjs && node test/client-smoke.cjs   # 或 npm test
```

两个脚本都不依赖 DSH 运行时：Host 半用假 `ctx`（`agents` / `webServer` / `effect` / `interval`），客户端半用假 `window.__ModuleLoader__` 与极简 React shim。

改完代码要生效：**重启 DSH**（改 `.js` 不会热重载；桌面端点插件市场里的「立即重启」）。

## 兼容与备注

- 状态文件与旧名 `dsh-clarify` 兼容：新文件不存在时读 `$DSH_HOME/dsh-clarify/state.json`，下次写入即迁到新路径。
- 只对**主会话**生效，子代理一律跳过。
- 卸载不会删你的状态文件；想清空就删 `$DSH_HOME/dsh-thinking-review/state.json`。
- 提示词优先级最低（order 89950），不会盖住项目自己的 AGENTS.md 或系统提示。

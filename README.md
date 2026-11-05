# dsh-thinking-review · 先想清楚，再复盘

DSH 插件，两件事：

1. **追问澄清**（per-session 开关）：开了以后，DSH 遇到需求含糊时先问清再动手；它只问「答案不同、做法就不同」的问题，问完给一句复述与推翻条件，然后直接做。
2. **复盘本会话**（按钮）：把这一轮问答、结论、成功经验整理成四块，再单独问你是否写入长期记忆；你同意哪几步，才写哪几步。

## 安装

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

## HTTP 接口

Host 半注册在 `/dsh-thinking-review`：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/dsh-thinking-review/state?session=<id>` | `{ok, session, enabled}` |
| POST | `/dsh-thinking-review/state` | body `{session, enabled}`，写入并立即挂载/卸载 |
| GET | `/dsh-thinking-review/text` | 当前进程实际生效的提示词（诊断用） |
| GET | `/dsh-thinking-review/mounted` | 已挂载的会话列表与状态文件路径 |

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

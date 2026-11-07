// dsh-thinking-review · 浏览器半边：输入框上方一排小控件
//   [追问澄清 开/关]  [复盘本会话 → 写入记忆]
window.__ModuleLoader__.load({
  id: 'dsh-thinking-review',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const h = React.createElement
    const inject = ['slots']
    const BASE = '/dsh-thinking-review'
    // 注意：register 的 name 必须是「槽位键」，不是插件名，否则 slots 会抛
    // slot "<name>" is not declared (a parent entry's children table must declare it)
    const SLOT = 'conversation.input.dock'
    // 左侧导航那一行的 id，同时也是主列页面的 key（两者必须一致）。
    const PANEL_ID = 'review-notes'
    const warn = (stage, err) => {
      try {
        console.error('[dsh-thinking-review] ' + stage, err)
      } catch (e) {}
    }

    const REVIEW_PROMPT = [
      '[复盘] 请对本次会话做一次复盘，并在写入长期记忆之前先征得我的同意。',
      '',
      '按下面四块输出 Markdown：',
      '1. 会话摘要：这次解决了什么；关键问答 3–6 条，每条一行。',
      '2. 结论与决定：定下来的方案、参数、路径、约定（要具体，别写"讨论了若干问题"这种空话）。',
      '3. 成功经验：这次哪些做法有效、哪些踩了坑；写成可复用的经验，带具体原因。',
      '4. 候选长期记忆：3–8 条，每条一句话、只装一件事（一个属性、一个约定、一次事件）；人称按记忆约定写（你自己是"我"，用户是"ta"），不写"今天/昨天"，时间交给系统。',
      '',
      '写完第 4 块后单独问我一句：「以上候选要写入长期记忆吗？（全部写入 / 只写入第几条 / 不要）」。',
      '只有我明确同意后才调用 remember 工具（每条一次调用，重要度按内容给）；没同意之前不要写入。若当前没有 remember 工具，就把候选条目整理成一段可复制的文本给我，并说明工具不可用。',
    ].join('\n')

    const S = {
      wrap: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '2px 2px 6px',
        fontSize: 12,
        color: 'var(--dsw-alias-text-secondary, #8b949e)',
        flexWrap: 'wrap',
      },
      pill: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 26,
        padding: '0 10px',
        borderRadius: 13,
        border: '1px solid rgba(127,127,127,0.35)',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        cursor: 'pointer',
      },
      pillOn: {
        border: '1px solid rgba(79,124,255,0.75)',
        background: 'rgba(79,124,255,0.16)',
        color: 'var(--dsw-alias-text-primary, inherit)',
      },
      dot: {
        width: 7,
        height: 7,
        borderRadius: 4,
        background: 'rgba(127,127,127,0.55)',
      },
      dotOn: {
        width: 7,
        height: 7,
        borderRadius: 4,
        background: '#4f7cff',
      },
      btn: {
        height: 26,
        padding: '0 10px',
        borderRadius: 13,
        border: '1px solid rgba(127,127,127,0.35)',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        cursor: 'pointer',
      },
      note: { opacity: 0.85 },
    }

    const P = {
      page: {
        height: '100%',
        overflowY: 'auto',
        padding: '18px 22px 40px',
        color: 'var(--dsw-alias-text-primary, inherit)',
        fontSize: 13,
      },
      head: { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14, flexWrap: 'wrap' },
      title: { fontSize: 16, fontWeight: 600 },
      sub: { flex: '1 1 auto', fontSize: 12, opacity: 0.6 },
      card: {
        border: '1px solid rgba(127,127,127,0.25)',
        borderRadius: 10,
        padding: '10px 12px',
        marginBottom: 10,
        background: 'rgba(127,127,127,0.04)',
      },
      row: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' },
      when: { fontSize: 12, opacity: 0.65 },
      name: { fontSize: 12, fontWeight: 600 },
      sum: { fontSize: 12, lineHeight: 1.6, opacity: 0.85, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
      text: {
        marginTop: 8,
        fontSize: 12,
        lineHeight: 1.7,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        maxHeight: 420,
        overflowY: 'auto',
        borderTop: '1px dashed rgba(127,127,127,0.3)',
        paddingTop: 8,
      },
      btn: {
        height: 24,
        padding: '0 9px',
        borderRadius: 12,
        border: '1px solid rgba(127,127,127,0.35)',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        cursor: 'pointer',
      },
      danger: { border: '1px solid rgba(220,80,80,0.55)', color: 'rgb(220,110,110)' },
      muted: { opacity: 0.55, cursor: 'default' },
      tag: {
        fontSize: 10,
        letterSpacing: 0.4,
        padding: '1px 6px',
        borderRadius: 6,
        border: '1px solid rgba(127,127,127,0.35)',
        opacity: 0.75,
      },
      empty: { fontSize: 12, opacity: 0.7, lineHeight: 1.9, maxWidth: 560 },
      grow: { flex: '1 1 auto' },
    }

    function merge(base, over) {
      return Object.assign({}, base, over || {})
    }

    function Dock(props) {
      const sid = props && props.sessionId ? String(props.sessionId) : ''
      const [enabled, setEnabled] = React.useState(null)
      const [exp, setExp] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState('')

      React.useEffect(() => {
        if (!sid) return undefined
        let alive = true
        fetch(BASE + '/state?session=' + encodeURIComponent(sid), { cache: 'no-store' })
          .then((r) => r.json())
          .then((json) => {
            if (alive && json && json.ok === true) setEnabled(json.enabled === true)
          })
          .catch(() => {})
        fetch(BASE + '/experience/state?session=' + encodeURIComponent(sid), { cache: 'no-store' })
          .then((r) => r.json())
          .then((json) => {
            if (alive && json && json.ok === true) setExp(json.enabled === true)
          })
          .catch(() => {})
        return () => {
          alive = false
        }
      }, [sid])

      const toggle = () => {
        if (!sid || busy) return
        const next = enabled !== true
        setBusy(true)
        setNote('')
        fetch(BASE + '/state', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ session: sid, enabled: next }),
        })
          .then((r) => r.json())
          .then((json) => {
            if (json && json.ok === true) {
              setEnabled(json.enabled === true)
              setNote(json.enabled === true ? '已开启：先问清楚再动手' : '已关闭：直接动手')
            } else {
              setNote('切换失败')
            }
          })
          .catch(() => setNote('切换失败：网络不通'))
          .then(() => setBusy(false))
      }

      const toggleExp = () => {
        if (!sid || busy) return
        const next = exp !== true
        setBusy(true)
        setNote('')
        fetch(BASE + '/experience/state', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ session: sid, enabled: next }),
        })
          .then((r) => r.json())
          .then((json) => {
            if (json && json.ok === true) {
              setExp(json.enabled === true)
              setNote(json.enabled === true ? '已开启：动手前先匹配复盘经验' : '已关闭：不先查经验库')
            } else {
              setNote('切换失败')
            }
          })
          .catch(() => setNote('切换失败：网络不通'))
          .then(() => setBusy(false))
      }

      const review = () => {
        if (busy) return
        if (typeof props.send !== 'function') {
          setNote('这个会话没有发送通道')
          return
        }
        setBusy(true)
        // 先登记，Host 才知道这一轮输出要收进「复盘经验」；登记失败也照样发。
        fetch(BASE + '/reviews/request', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ session: sid }),
        })
          .catch(() => {})
          .then(() => props.send(REVIEW_PROMPT))
          .then(() => setNote('已发出复盘，产出会收进「复盘经验」'))
          .catch(() => setNote('发送失败'))
          .then(() => setBusy(false))
      }

      const on = enabled === true
      const expOn = exp === true
      return h(
        'div',
        { style: S.wrap },
        h(
          'button',
          {
            type: 'button',
            style: merge(S.pill, on ? S.pillOn : null),
            onClick: toggle,
            disabled: busy,
            title: '开启后，每一轮必须先想问题：没问就先调工具会被 Host 拦下（可以先说「无需提问：理由」放行）',
          },
          h('span', { style: on ? S.dotOn : S.dot }),
          '追问澄清：' + (on ? '开' : '关'),
        ),
        h(
          'button',
          {
            type: 'button',
            style: merge(S.pill, expOn ? S.pillOn : null),
            onClick: toggleExp,
            disabled: busy,
            title: '开启后，动手前先到「复盘经验」里找相似场景；每三天自动整理一次',
          },
          h('span', { style: expOn ? S.dotOn : S.dot }),
          '经验优先：' + (expOn ? '开' : '关'),
        ),
        h(
          'button',
          { type: 'button', style: S.btn, onClick: review, disabled: busy, title: '总结本会话并提议写入长期记忆' },
          '复盘本会话',
        ),
        note ? h('span', { style: S.note }, note) : null,
      )
    }

    /* ---------- 左侧导航：复盘经验 ---------- */

    /** 侧栏只画图标（行文字由外壳用 label 渲染）；data-dsh-panel-entry 给皮肤认行。 */
    function PanelIcon(props) {
      const size = props && typeof props.size === "number" && props.size > 0 ? props.size : 16
      return h(
        "svg",
        {
          "data-dsh-panel-entry": PANEL_ID,
          viewBox: "0 0 16 16",
          width: size,
          height: size,
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.5,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": "true",
        },
        h("path", { d: "M3.25 2.25h6.5l3 3v8.5a.75.75 0 0 1-.75.75H3.25a.75.75 0 0 1-.75-.75V3a.75.75 0 0 1 .75-.75Z" }),
        h("path", { d: "M9.5 2.5v3.25h3.25" }),
        h("path", { d: "M5 8h5" }),
        h("path", { d: "M5 10.5h5" }),
      )
    }

    function fmtTime(iso) {
      try {
        const d = new Date(iso)
        if (isNaN(d.getTime())) return String(iso || "")
        const pad = (n) => (n < 10 ? "0" + n : String(n))
        return (
          d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
          " " + pad(d.getHours()) + ":" + pad(d.getMinutes())
        )
      } catch (e) {
        return String(iso || "")
      }
    }

    function ReviewNotesPage() {
      const [items, setItems] = React.useState([])
      const [loading, setLoading] = React.useState(true)
      const [note, setNote] = React.useState("")
      const [openId, setOpenId] = React.useState("")
      const [openText, setOpenText] = React.useState("")
      const [busy, setBusy] = React.useState(false)
      const [confirmId, setConfirmId] = React.useState("")

      const load = React.useCallback(() => {
        setLoading(true)
        fetch(BASE + "/reviews", { cache: "no-store" })
          .then((r) => {
            if (r.status === 404) {
              setItems([])
              setNote("Host 还是旧代码：/reviews 路由不存在，重启 DSH 后才有这一栏")
              return null
            }
            if (!r.ok) {
              setNote("读取失败：HTTP " + r.status)
              return null
            }
            return r.json()
          })
          .then((json) => {
            if (!json) return
            if (json && json.ok === true && Array.isArray(json.reviews)) {
              setItems(json.reviews)
              setNote(json.pending && json.pending.length > 0 ? "正在等某一轮的复盘输出…" : "")
            } else {
              setNote("读取失败")
            }
          })
          .catch(() => setNote("读取失败：网络不通"))
          .then(() => setLoading(false))
      }, [])

      const [lessons, setLessons] = React.useState(null)
      const [query, setQuery] = React.useState("")
      const [digesting, setDigesting] = React.useState(false)
      const [showLessons, setShowLessons] = React.useState(true)

      const loadLessons = React.useCallback((q) => {
        const url = BASE + "/lessons?limit=40" + (q ? "&q=" + encodeURIComponent(q) : "")
        fetch(url, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .then((json) => {
            if (json && json.ok === true) setLessons(json)
            else if (json === null) setNote("Host 还是旧代码：/lessons 路由不存在，重启 DSH 后才有经验库")
          })
          .catch(() => {})
      }, [])

      const digest = () => {
        if (digesting) return
        setDigesting(true)
        fetch(BASE + "/lessons/digest", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
          .then((r) => (r.ok ? r.json() : null))
          .then((json) => {
            if (json && json.ok === true) {
              setNote("已整理：" + json.total + " 条经验")
              loadLessons(query)
            } else {
              setNote("整理失败")
            }
          })
          .catch(() => setNote("整理失败：网络不通"))
          .then(() => setDigesting(false))
      }

      React.useEffect(() => {
        load()
        loadLessons("")
      }, [load, loadLessons])

      const open = (id) => {
        if (openId === id) {
          setOpenId("")
          setOpenText("")
          return
        }
        setOpenId(id)
        setOpenText("")
        setBusy(true)
        fetch(BASE + "/reviews/item?id=" + encodeURIComponent(id), { cache: "no-store" })
          .then((r) => r.json())
          .then((json) => {
            if (json && json.ok === true && json.review) setOpenText(String(json.review.text || ""))
            else setNote("这条读不出来")
          })
          .catch(() => setNote("这条读不出来"))
          .then(() => setBusy(false))
      }

      const putClipboard = (text) => {
        try {
          if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(
              () => setNote("已复制到剪贴板"),
              () => setNote("复制失败：浏览器不给剪贴板权限"),
            )
            return true
          }
        } catch (e) {}
        return false
      }

      const copy = (item) => {
        if (openId === item.id && openText !== "") {
          if (!putClipboard(openText)) setNote("这个环境不支持复制，展开后用鼠标选中")
          return
        }
        setBusy(true)
        fetch(BASE + "/reviews/item?id=" + encodeURIComponent(item.id), { cache: "no-store" })
          .then((r) => r.json())
          .then((json) => {
            const text = json && json.ok === true && json.review ? String(json.review.text || "") : ""
            if (text === "") setNote("这条读不出来")
            else if (!putClipboard(text)) setNote("这个环境不支持复制，展开后用鼠标选中")
          })
          .catch(() => setNote("复制失败"))
          .then(() => setBusy(false))
      }

      const showFile = (item) => {
        if (!item.file) {
          setNote("这条的文件还在生成，几秒后再刷新")
          return
        }
        try {
          const url = BASE + "/reviews/file?id=" + encodeURIComponent(item.id)
          const win = window.open(url, "_blank", "noopener")
          if (!win) setNote("浏览器拦了新窗口：允许弹窗，或右键「复制链接」打开 " + url)
        } catch (e) {
          setNote("打不开文件")
        }
      }

      const remove = (id) => {
        if (confirmId !== id) {
          setConfirmId(id)
          setNote("再点一次「确认删除」就删掉，删了就找不回来")
          return
        }
        setConfirmId("")
        setBusy(true)
        fetch(BASE + "/reviews/delete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id }),
        })
          .then((r) => r.json())
          .then((json) => {
            if (json && json.ok === true) {
              if (openId === id) {
                setOpenId("")
                setOpenText("")
              }
              setNote("已删除")
              load()
            } else {
              setNote("删除失败")
            }
          })
          .catch(() => setNote("删除失败：网络不通"))
          .then(() => setBusy(false))
      }

      const rows = items.map((item) => {
        const openHere = openId === item.id
        const confirming = confirmId === item.id
        return h(
          "div",
          { key: item.id, style: P.card },
          h(
            "div",
            { style: P.row },
            h("span", { style: P.when }, fmtTime(item.updatedAt || item.createdAt)),
            h("span", { style: P.name }, item.title || "会话 " + String(item.sessionId || "").slice(0, 8)),
            h("span", { style: P.when }, item.auto && item.sections > 1 ? "共 " + item.sections + " 段" : String(item.chars || 0) + " 字"),
            h("span", { style: P.tag }, item.kind === "pdf" ? "PDF" : item.kind === "md" ? "MD" : "生成中"),
            h("span", { style: P.grow }),
            h(
              "button",
              {
                type: "button",
                style: item.file ? P.btn : merge(P.btn, P.muted),
                onClick: () => showFile(item),
              },
              "打开",
            ),
            h("button", { type: "button", style: P.btn, onClick: () => open(item.id), disabled: busy }, openHere ? "收起" : "展开"),
            h("button", { type: "button", style: P.btn, onClick: () => copy(item), disabled: busy }, "复制"),
            h(
              "button",
              { type: "button", style: merge(P.btn, P.danger), onClick: () => remove(item.id), disabled: busy },
              confirming ? "确认删除" : "删除",
            ),
          ),
          openHere ? null : h("div", { style: P.sum }, item.summary || "（这条没有摘要）"),
          openHere ? h("div", { style: P.text }, openText !== "" ? openText : busy ? "读取中…" : "（空）") : null,
        )
      })

      const lessonRows = lessons && Array.isArray(lessons.lessons)
        ? lessons.lessons.map((lesson) =>
            h(
              "div",
              { key: lesson.id, style: P.sum },
              h("span", { style: P.tag }, lesson.id),
              " ",
              lesson.text,
              lesson.hits > 1 ? h("span", { style: P.when }, "（出现 " + lesson.hits + " 次）") : null,
            ),
          )
        : []

      const learningCard = h(
        "div",
        { style: P.card },
        h(
          "div",
          { style: P.row },
          h("span", { style: P.name }, "经验库"),
          h(
            "span",
            { style: P.when },
            lessons
              ? "共 " + lessons.total + " 条 · 每三天自动整理" +
                (lessons.updatedAt ? " · 上次 " + fmtTime(lessons.updatedAt) : " · 还没整理")
              : "读取中…",
          ),
          h("span", { style: P.grow }),
          h("button", { type: "button", style: P.btn, onClick: digest, disabled: digesting }, digesting ? "整理中…" : "立即整理"),
          h("button", { type: "button", style: P.btn, onClick: () => setShowLessons(!showLessons) }, showLessons ? "收起" : "展开"),
        ),
        h(
          "div",
          { style: P.sum },
          "每次复盘的「结论与决定 / 成功经验 / 候选长期记忆」会被抽成条目、去重合并。在对话页把「经验优先」打开后，DSH 动手前会先按本轮诉求匹配这里的条目，找到就引用其编号与适用条件。",
        ),
        showLessons
          ? h(
              "div",
              { style: { marginTop: 8, display: "flex", gap: 8, alignItems: "center" } },
              h("input", {
                value: query,
                placeholder: "检索经验（回车搜）",
                onChange: (e) => setQuery(e.target.value),
                onKeyDown: (e) => {
                  if (e.key === "Enter") loadLessons(query)
                },
                style: {
                  flex: "1 1 auto",
                  height: 26,
                  padding: "0 10px",
                  borderRadius: 13,
                  border: "1px solid rgba(127,127,127,0.35)",
                  background: "transparent",
                  color: "inherit",
                  font: "inherit",
                },
              }),
              h("button", { type: "button", style: P.btn, onClick: () => loadLessons(query) }, "检索"),
              h(
                "button",
                { type: "button", style: P.btn, onClick: () => { setQuery(""); loadLessons("") } },
                "清空",
              ),
            )
          : null,
        showLessons && lessonRows.length > 0
          ? h("div", { style: P.text }, lessonRows)
          : showLessons && lessons
            ? h("div", { style: P.sum }, "还没有经验条目：先攒几条复盘，再点「立即整理」。")
            : null,
      )

      return h(
        "div",
        { style: P.page, "data-dsh-panel-page": PANEL_ID },
        h(
          "div",
          { style: P.head },
          h("div", { style: P.title }, "复盘经验"),
          h("div", { style: P.sub }, loading ? "读取中…" : "共 " + items.length + " 条" + (note ? " · " + note : "")),
          h("button", { type: "button", style: P.btn, onClick: load, disabled: loading }, "刷新"),
        ),
        learningCard,
        !loading && items.length === 0
          ? h(
              "div",
              { style: P.empty },
              "还没有复盘记录。",
              h("br"),
              "每个会话都会自动存档成一页 PDF：聊过的内容按「最近进展 + 每次复盘」并进同一份，反复复盘只更新同一份，不会堆出一串重复文件。",
              h("br"),
              "在对话页点「复盘本会话」会立刻把这一轮复盘也并进该会话的同一份 PDF。",
            )
          : null,
        rows,
      )
    }

    function sendTo(ctx, sessionId, text) {
      const sessions = ctx.get('sessions')
      const scope = sessions.scope(sessionId)
      const conversation = scope.get('conversation')
      return conversation.send(text)
    }

    function apply(ctx) {
      const slots = ctx.slots || ctx.get('slots')
      if (!slots) {
        warn('apply: slots service unavailable')
        return
      }
      const register = (slotName, make) => {
        slots.inject(slotName, () => {
          try {
            return make()
          } catch (err) {
            warn('apply: slot registration failed (' + slotName + ')', err)
            throw err
          }
        })
      }

      // 输入框上方那一排控件。
      register(SLOT, () =>
        slots.register(
          {
            name: SLOT,
            id: 'dsh-thinking-review',
            order: 40,
            inject: (sessionId) => ({
              sessionId: String(sessionId),
              send: (text) => sendTo(ctx, String(sessionId), text),
            }),
          },
          Dock,
        ),
      )

      // 左侧导航多一行「复盘经验」+ 对应的主列页面（key 必须与 id 相同）。
      register('sidebar.panellist', () =>
        slots.register(
          { name: 'sidebar.panellist', id: PANEL_ID, order: 60, label: () => '复盘经验' },
          PanelIcon,
        ),
      )
      register('main', () =>
        slots.register({ name: 'main', key: PANEL_ID, inject: () => ({}) }, ReviewNotesPage),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
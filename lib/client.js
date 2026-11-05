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

    function merge(base, over) {
      return Object.assign({}, base, over || {})
    }

    function Dock(props) {
      const sid = props && props.sessionId ? String(props.sessionId) : ''
      const [enabled, setEnabled] = React.useState(null)
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

      const review = () => {
        if (busy) return
        if (typeof props.send !== 'function') {
          setNote('这个会话没有发送通道')
          return
        }
        setBusy(true)
        Promise.resolve(props.send(REVIEW_PROMPT))
          .then(() => setNote('已发出复盘，等在对话里回我'))
          .catch(() => setNote('发送失败'))
          .then(() => setBusy(false))
      }

      const on = enabled === true
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
            title: '开启后，本次会话先问清楚再动手；随时可关',
          },
          h('span', { style: on ? S.dotOn : S.dot }),
          '追问澄清：' + (on ? '开' : '关'),
        ),
        h(
          'button',
          { type: 'button', style: S.btn, onClick: review, disabled: busy, title: '总结本会话并提议写入长期记忆' },
          '复盘本会话',
        ),
        note ? h('span', { style: S.note }, note) : null,
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
      slots.inject(SLOT, () => {
        try {
          return slots.register(
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
          )
        } catch (err) {
          warn('apply: slot registration failed (' + SLOT + ')', err)
          throw err
        }
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
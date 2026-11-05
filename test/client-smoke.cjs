// 前端冒烟：假 window.__ModuleLoader__ + 极简 React shim，不碰真实浏览器。
const path = require('node:path')
const assert = require('node:assert')

const hooks = []
let hookIndex = 0

const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState(initial) {
    const i = hookIndex++
    if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial
    return [hooks[i], (next) => { hooks[i] = typeof next === 'function' ? next(hooks[i]) : next }]
  },
  useEffect() {
    hookIndex++
  },
  useCallback(fn) {
    hookIndex++
    return fn
  },
}

let loaded = null
global.window = {
  __ModuleLoader__: {
    load(entry) {
      loaded = entry
    },
  },
}

require(path.join(__dirname, '..', 'lib', 'client.js'))
assert.ok(loaded, '客户端没有调用 __ModuleLoader__.load')
assert.strictEqual(loaded.id, 'dsh-thinking-review')

const mod = loaded.factory((name) => {
  assert.strictEqual(name, 'react')
  return React
})
console.log('exports:', Object.keys(mod).join(','), 'inject:', JSON.stringify(mod.inject))

const registrations = []
const sent = []
const ALLOWED_SLOTS = ['conversation.input.dock', 'sidebar.panellist', 'main']
const ctx = {
  slots: {
    inject(name, fn) {
      assert.ok(ALLOWED_SLOTS.includes(name), '注册了未知槽位：' + name)
      fn()
    },
    register(props, Component) {
      registrations.push({ props, Component })
      return () => {}
    },
  },
  get(name) {
    assert.strictEqual(name, 'sessions')
    return {
      scope(sid) {
        return {
          get(service) {
            assert.strictEqual(service, 'conversation')
            return { send: (text) => sent.push({ sid, text }) }
          },
        }
      },
    }
  },
}

mod.apply(ctx)
assert.strictEqual(registrations.length, 3, '应当是 dock + 侧栏一行 + 主列页面')

const dock = registrations.find((r) => r.props.name === 'conversation.input.dock')
const row = registrations.find((r) => r.props.name === 'sidebar.panellist')
const page = registrations.find((r) => r.props.name === 'main')
assert.ok(dock && row && page, '三类注册没齐')
assert.strictEqual(row.props.id, 'review-notes')
assert.strictEqual(row.props.label(), '复盘经验')
assert.strictEqual(page.props.key, row.props.id, '主列 key 必须与侧栏 id 一致')
assert.deepStrictEqual(row.Component({ size: 16 }), row.Component({ size: 16 }))
console.log('侧栏行:', row.props.id, row.props.label(), 'order:', row.props.order, '| 主列 key:', page.props.key)

const { props, Component } = dock
console.log('slot id:', props.id, 'order:', props.order)

const injected = props.inject('s1')
assert.strictEqual(injected.sessionId, 's1')
global.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true, enabled: false }) })

hookIndex = 0
hooks.length = 0
const tree = Component(injected)
const texts = []
const walk = (node) => {
  if (node === null || node === undefined) return
  if (Array.isArray(node)) return node.forEach(walk)
  if (typeof node === 'string') return texts.push(node)
  if (typeof node === 'object') {
    if (node.children) node.children.forEach(walk)
  }
}
walk(tree)
console.log('按钮文案:', texts.join(' | '))
assert.ok(texts.some((t) => t.startsWith('追问澄清')), '缺少开关按钮')
assert.ok(texts.some((t) => t === '复盘本会话'), '缺少复盘按钮')

// 复盘：把指令发进当前会话
const reviewBtn = tree.children[1]
reviewBtn.props.onClick()
setTimeout(() => {
  assert.strictEqual(sent.length, 1, '复盘指令没有落到会话')
  assert.strictEqual(sent[0].sid, 's1')
  assert.ok(sent[0].text.includes('复盘'), '指令里没有「复盘」')
  assert.ok(sent[0].text.includes('remember'), '指令里没有 remember 同意流程')
  console.log('复盘指令已发出, 长度', sent[0].text.length)

  // 复盘经验页：空列表时给说明，不白屏
  global.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true, reviews: [], pending: [] }) })
  hookIndex = 0
  hooks.length = 0
  const pageTree = page.Component({})
  const pageTexts = []
  const walkPage = (node) => {
    if (node === null || node === undefined) return
    if (Array.isArray(node)) return node.forEach(walkPage)
    if (typeof node === 'string') return pageTexts.push(node)
    if (typeof node === 'object' && node.children) node.children.forEach(walkPage)
  }
  walkPage(pageTree)
  console.log('页面文案:', pageTexts.join(' | '))
  assert.ok(pageTexts.includes('复盘经验'), '页面没有标题')
  assert.ok(pageTexts.includes('刷新'), '页面没有刷新按钮')

  console.log('CLIENT SMOKE OK')
}, 0)

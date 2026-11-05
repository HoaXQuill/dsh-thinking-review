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
const ctx = {
  slots: {
    inject(name, fn) {
      assert.strictEqual(name, 'conversation.input.dock')
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
assert.strictEqual(registrations.length, 1, '应当只注册一个 dock')
const { props, Component } = registrations[0]
console.log('slot id:', props.id, 'order:', props.order)

const injected = props.inject('s1')
assert.strictEqual(injected.sessionId, 's1')
global.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true, enabled: false }) })

hookIndex = 0
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
  console.log('CLIENT SMOKE OK')
}, 0)

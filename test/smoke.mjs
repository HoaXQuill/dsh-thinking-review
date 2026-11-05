import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'thinking-review-smoke-'))

const mod = await import('../lib/index.js')

const sections = []
const disposed = []
const routes = new Map()
const agent = {
  session: { id: 's1', header: {} },
  ctx: {
    systemPrompt: {
      section(opts) {
        sections.push(opts)
        return () => disposed.push(opts.name)
      },
    },
  },
}
const subagent = { session: { id: 's2', header: { origin: 'subagent' } }, ctx: agent.ctx }

let listed = [agent, subagent]
const ctx = {
  agents: { list: () => listed },
  webServer: { register: (r) => { routes.set(r.path, r.handler); return () => {} } },
  effect: (fn) => { const d = fn(); return () => { if (typeof d === 'function') d() } },
  interval: () => () => {},
}

mod.apply(ctx)
console.log('name/inject:', mod.name, JSON.stringify(mod.inject))
console.log('routes:', [...routes.keys()].join(','))
console.log('sections after boot (expect 0):', sections.length)

function call(route, method, url, body) {
  return new Promise((resolve) => {
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)])
    req.method = method
    req.url = url
    req.headers = {}
    const out = { code: 0, body: '' }
    const res = { writeHead(code) { out.code = code }, end(text) { out.body = String(text); resolve(out) } }
    routes.get(route)(req, res).catch((err) => { out.code = 500; out.body = String(err); resolve(out) })
  })
}

console.log('GET off:', JSON.stringify(await call('/dsh-thinking-review/state', 'GET', '/dsh-thinking-review/state?session=s1')))
console.log('POST on:', JSON.stringify(await call('/dsh-thinking-review/state', 'POST', '/dsh-thinking-review/state', { session: 's1', enabled: true })))
console.log('sections after on (expect 1):', sections.length, sections[0] && sections[0].name, 'order', sections[0] && sections[0].order)
console.log('subagent 未挂:', sections.every((s) => s.name === 'plugin:dsh-thinking-review'))

// 提示词关键判据别在改动中丢掉（来自《高阶思维：核验与修正与重构》）。
const text = sections[0].text()
for (const needle of ['信息价值为零', '先找决策', '至少 3 种合理解读', '分离预测', '做法分岔', '只读侦察', '什么会让你改主意', '一行边界']) {
  if (!text.includes(needle)) throw new Error('提示词缺少判据：' + needle)
}
console.log('判据齐全，字数：', text.length)

// 诊断路由：拿到的就是挂上去的那段
const diag = JSON.parse((await call('/dsh-thinking-review/text', 'GET', '/dsh-thinking-review/text')).body)
if (diag.text !== text) throw new Error('/text 与挂载文本不一致')
console.log('/text 一致')

console.log('POST off:', JSON.stringify(await call('/dsh-thinking-review/state', 'POST', '/dsh-thinking-review/state', { session: 's1', enabled: false })))
console.log('disposed:', JSON.stringify(disposed))
console.log('mounted:', (await call('/dsh-thinking-review/mounted', 'GET', '/dsh-thinking-review/mounted')).body)
console.log('bad GET:', JSON.stringify(await call('/dsh-thinking-review/state', 'GET', '/dsh-thinking-review/state')))

// 重启后从文件恢复（此时文件里是 off）
const before = sections.length
mod.apply({ ...ctx, webServer: { register: () => () => {} } })
console.log('reboot 后未多挂:', sections.length === before)
console.log('SMOKE OK')

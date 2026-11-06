import { mkdtempSync, readFileSync as readFileSync2 } from 'node:fs'
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
const listeners = []
const ctx = {
  agents: { list: () => listed },
  webServer: { register: (r) => { routes.set(r.path, r.handler); return () => {} } },
  effect: (fn) => { const d = fn(); return () => { if (typeof d === 'function') d() } },
  interval: () => () => {},
  on: (type, fn, opts) => { listeners.push({ type, fn, opts }); return () => {} },
  get: (name) => (name === 'sessions' ? { get: () => ({ title: '冒烟会话' }) } : undefined),
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
for (const needle of [
  '信息价值为零', '主动提问', '先找决策',
  '十个面', '目标：', '交付物与格式', '验收标准', '范围与不做', '约束：', '环境与权限', '数据与来源', '时间与优先级', '可逆性', '既有约定',
  '工具盘查', '替代方案', '装的代价', '最小可用的验证', '不要推销安装',
  '至少 3 种合理解读', '分离预测', '做法分岔', '只读侦察', '什么会让你改主意', '一行边界',
]) {
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

// —— 复盘捕获：登记 → 攒正文 → 一轮结束落库 ——
const emit = (event) => {
  for (const l of listeners) if (l.type === 'session/event') l.fn('s1', event)
}
const longText = '复盘：这次先把按钮修好了，根因是槽位键写错，客户端整个 apply 失败。'.repeat(8)
console.log('登记:', JSON.stringify(await call('/dsh-thinking-review/reviews/request', 'POST', '/dsh-thinking-review/reviews/request', { session: 's1' })))
emit({ type: 'assistant/message', data: { message: { content: [
  { type: 'reasoning', text: '先想想' },
  { type: 'text', text: longText },
  { type: 'tool-call', id: 't1', name: 'remember', arguments: {} },
] } } })
emit({ type: 'turn/end', data: {} })

const list = JSON.parse((await call('/dsh-thinking-review/reviews', 'GET', '/dsh-thinking-review/reviews')).body)
if (list.reviews.length !== 1) throw new Error('复盘没落库，条数=' + list.reviews.length)
const rec = list.reviews[0]
if (!rec.chars || rec.chars < 160) throw new Error('复盘字数不对：' + rec.chars)
if (!rec.summary || rec.summary.length === 0) throw new Error('没有摘要')
if (rec.title !== '冒烟会话') throw new Error('标题没抓到：' + rec.title)
console.log('落库:', rec.id, rec.chars, '字, 标题', rec.title)

// 落盘：reviews.json 里能读到同一条（重启后靠它恢复）
const onDisk = JSON.parse(readFileSync2(join(process.env.DSH_HOME, 'dsh-thinking-review', 'reviews.json'), 'utf8'))
if (!Array.isArray(onDisk.reviews) || onDisk.reviews.length !== 1) throw new Error('reviews.json 没写对')
console.log('落盘 OK:', onDisk.reviews[0].id)

const item = JSON.parse((await call('/dsh-thinking-review/reviews/item', 'GET', '/dsh-thinking-review/reviews/item?id=' + encodeURIComponent(rec.id))).body)
if (!item.ok || !item.review.text.includes('槽位键')) throw new Error('全文没取到')

// 太短的输出丢掉，不落库
await call('/dsh-thinking-review/reviews/request', 'POST', '/dsh-thinking-review/reviews/request', { session: 's1' })
emit({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '太短' }] } } })
emit({ type: 'turn/end', data: {} })
const afterShort = JSON.parse((await call('/dsh-thinking-review/reviews', 'GET', '/dsh-thinking-review/reviews')).body)
if (afterShort.reviews.length !== 1) throw new Error('短输出也落库了')

// 没登记过的会话根本不收
emit({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: longText }] } } })
emit({ type: 'turn/end', data: {} })
console.log('未登记会话未收:', JSON.parse((await call('/dsh-thinking-review/reviews', 'GET', '/dsh-thinking-review/reviews')).body).reviews.length === 1)

// 删除
console.log('删除:', (await call('/dsh-thinking-review/reviews/delete', 'POST', '/dsh-thinking-review/reviews/delete', { id: rec.id })).body)
const afterDelete = JSON.parse((await call('/dsh-thinking-review/reviews', 'GET', '/dsh-thinking-review/reviews')).body)
if (afterDelete.reviews.length !== 0) throw new Error('删除没生效')

// 重启后从文件恢复（此时文件里是 off）
const before = sections.length
mod.apply({ ...ctx, webServer: { register: () => () => {} } })
console.log('reboot 后未多挂:', sections.length === before)
console.log('SMOKE OK')

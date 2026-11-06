// 真起浏览器验证 PDF 生成。沙箱里 Edge 起不来，需 danger-full-access 跑：
//   node test/pdf-check.mjs
import { mkdirSync, mkdtempSync, readFileSync, existsSync, statSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

// 放在工作区里，失败时好直接看目录
const base = join(process.cwd(), '.tmp-pdf')
rmSync(base, { recursive: true, force: true })
mkdirSync(base, { recursive: true })
process.env.DSH_HOME = mkdtempSync(join(base, 'home-'))
delete process.env.DSH_THINKING_REVIEW_NO_PDF

const mod = await import('../lib/index.js')
const routes = new Map()
const listeners = []
const agent = { session: { id: 'p1', header: {} }, ctx: { systemPrompt: { section: () => () => {} } } }
const ctx = {
  agents: { list: () => [agent] },
  webServer: { register: (r) => { routes.set(r.path, r.handler); return () => {} } },
  effect: (fn) => { const d = fn(); return () => { if (typeof d === 'function') d() } },
  interval: () => () => {},
  on: (type, fn) => { listeners.push({ type, fn }); return () => {} },
  get: (name) => (name === 'sessions' ? { get: () => ({ title: 'PDF 冒烟' }) } : undefined),
}
mod.apply(ctx)

function call(route, method, url, body) {
  return new Promise((resolve) => {
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)])
    req.method = method
    req.url = url
    req.headers = {}
    const out = { code: 0, body: '', headers: {}, raw: null }
    const res = { writeHead: (code, headers) => { out.code = code; out.headers = headers || {} }, end: (chunk) => { out.raw = chunk; out.body = typeof chunk === 'string' ? chunk : ''; resolve(out) } }
    routes.get(route)(req, res).catch((e) => resolve({ code: 500, body: String(e) }))
  })
}

await call('/dsh-thinking-review/reviews/request', 'POST', '/dsh-thinking-review/reviews/request', { session: 'p1' })
const text = ['# 复盘：PDF 生成冒烟', '', '## 会话摘要', '这一轮验证复盘能落成 PDF，顺便看看中文断行和列表排版。'.repeat(6), '', '## 结论', '- 第一条结论'.repeat(3), '- 第二条结论'].join('\n')
for (const l of listeners) {
  if (l.type !== 'session/event') continue
  l.fn('p1', { type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } })
  l.fn('p1', { type: 'turn/end', data: {} })
}

const file = await (async () => {
  const start = Date.now()
  while (Date.now() - start < 60000) {
    try {
      const parsed = JSON.parse(readFileSync(join(process.env.DSH_HOME, 'dsh-thinking-review', 'reviews.json'), 'utf8'))
      const first = parsed.reviews && parsed.reviews[0]
      if (first && first.file) return first
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 200))
  }
  return null
})()
if (!file) {
  const dir = join(process.env.DSH_HOME, 'dsh-thinking-review')
  console.log('目录:', dir)
  try { console.log('文件:', readdirSync(dir).join(', ')) } catch (e) { console.log('目录读不出:', String(e)) }
  try { console.log('reviews 子目录:', readdirSync(join(dir, 'reviews')).join(', ')) } catch (e) { console.log('reviews 子目录没有:', String(e)) }
  try { console.log('索引:', readFileSync(join(dir, 'reviews.json'), 'utf8').slice(0, 600)) } catch (e) {}
  throw new Error('文件没生成')
}
console.log('文件:', file.kind, file.file, statSync(file.file).size, 'bytes')
if (file.kind !== 'pdf') throw new Error('期望 pdf，得到 ' + file.kind)
const head = readFileSync(file.file).subarray(0, 5).toString()
if (head !== '%PDF-') throw new Error('不是 PDF：' + head)
const res = await call('/dsh-thinking-review/reviews/file', 'GET', '/dsh-thinking-review/reviews/file?id=' + encodeURIComponent(file.id))
console.log('route:', res.code, res.headers['content-type'], res.raw && res.raw.length, 'bytes')
console.log('PDF OK')

// 留下文件路径，供人眼核对
console.log('留在:', file.file)
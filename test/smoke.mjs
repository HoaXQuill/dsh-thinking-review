import { existsSync, mkdtempSync, readFileSync as readFileSync2 } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'thinking-review-smoke-'))
// 冒烟不起浏览器进程：复盘文件走 .md 分支（PDF 分支在真实安装里验证）。
process.env.DSH_THINKING_REVIEW_NO_PDF = '1'

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
    const out = { code: 0, body: '', headers: {}, raw: null }
    const res = {
      writeHead(code, headers) { out.code = code; out.headers = headers || {} },
      end(chunk) {
        out.raw = chunk
        out.body = typeof chunk === 'string' ? chunk : ''
        resolve(out)
      },
    }
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
  '停住等答案', '把沉默当成同意', '超时只表示没收到答案',
  '至少 3 种合理解读', '分离预测', '做法分岔', '只读侦察', '什么会让你改主意', '一行边界',
  '多维扫描', '六个维度', '对象维', '尺度维', '时间维', '因果维', '反证维', '二阶维',
  '提问门槛', '答错会差在哪', '拦路', '塑形', '重扫十个面与六个维度',
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

// —— 自动存档：每个会话一条档案，同一会话的复盘并进同一份 ——
const emit = (session, event) => {
  for (const l of listeners) if (l.type === 'session/event') l.fn(session, event)
}
const userMsg = (text) => ({ type: 'user/message', data: { message: { content: [{ type: 'text', text }] } } })
const botMsg = (text) => ({ type: 'assistant/message', data: { message: { content: [
  { type: 'reasoning', text: '先想想' },
  { type: 'text', text },
  { type: 'tool-call', id: 't1', name: 'remember', arguments: {} },
] } } })
const endTurn = () => ({ type: 'turn/end', data: {} })
const listOf = async () => JSON.parse((await call('/dsh-thinking-review/reviews', 'GET', '/dsh-thinking-review/reviews')).body)

const askText = '把这个会话的复盘做成 PDF，同一会话不要重复生成。'
const answerText = '改好了：每个会话一条档案，同一会话的后续复盘并进同一份 PDF，同样的段落只留一份。'.repeat(3)
emit('s1', userMsg(askText))
emit('s1', botMsg(answerText))
emit('s1', endTurn())

const list1 = await listOf()
if (list1.reviews.length !== 1) throw new Error('没自动存档，条数=' + list1.reviews.length)
const auto = list1.reviews[0]
if (auto.id !== 'session-s1') throw new Error('档案 id 不是会话固定 id：' + auto.id)
if (auto.auto !== true) throw new Error('没标成自动档案')
if (auto.sections !== 1) throw new Error('第一轮应该只有「最近进展」一段，得到 ' + auto.sections)
if (!auto.chars || auto.chars < 160) throw new Error('档案字数不对：' + auto.chars)
if (auto.title !== '冒烟会话') throw new Error('标题没抓到：' + auto.title)
console.log('自动存档:', auto.id, auto.chars, '字, 段数', auto.sections, '标题', auto.title)

// 落盘：reviews.json 里能读到同一条（重启后靠它恢复）
const diskPath = join(process.env.DSH_HOME, 'dsh-thinking-review', 'reviews.json')
const onDisk = JSON.parse(readFileSync2(diskPath, 'utf8'))
if (!Array.isArray(onDisk.reviews) || onDisk.reviews.length !== 1) throw new Error('reviews.json 没写对')
if (onDisk.reviews[0].updatedAt === '') throw new Error('没记更新时间')
console.log('落盘 OK:', onDisk.reviews[0].id)

const waitFor = async (fn, ms) => {
  const start = Date.now()
  while (Date.now() - start < ms) {
    const value = await fn()
    if (value) return value
    await new Promise((r) => setTimeout(r, 100))
  }
  return ''
}
const fileOf = (id) => waitFor(() => {
  try {
    const disk = JSON.parse(readFileSync2(diskPath, 'utf8'))
    const found = (disk.reviews || []).find((item) => item.id === id)
    return found && typeof found.file === 'string' && found.file !== '' ? found.file : ''
  } catch (error) {
    return ''
  }
}, 10000)

const firstFile = await fileOf(auto.id)
if (firstFile === '') throw new Error('档案文件没生成')
if (!firstFile.endsWith('.md')) throw new Error('NO_PDF 下应该是 .md，得到 ' + firstFile)
if (!readFileSync2(firstFile, 'utf8').includes('最近进展')) throw new Error('文件里没有自动存档段')
console.log('档案文件:', firstFile.endsWith('.md') ? 'md' : 'other')

// 一次完整复盘：并进同一个会话档案，多一段
const reviewText = [
  '## 会话摘要', '', '这一轮把复盘落成 PDF，并让后续复盘并进同一份。'.repeat(6),
  '', '## 结论与决定', '', '每个会话固定一条档案，id 就是 session-<会话>，文件路径固定所以覆盖同一份。'.repeat(3),
  '', '## 成功经验', '', '难点在去重：同一段文字归一化后相同就不再追加，只更新时间。'.repeat(4),
  '', '## 候选长期记忆', '', '无。',
].join('\n')
emit('s1', botMsg(reviewText))
emit('s1', endTurn())

const list2 = await listOf()
if (list2.reviews.length !== 1) throw new Error('复盘另起了一条，条数=' + list2.reviews.length)
if (list2.reviews[0].id !== auto.id) throw new Error('复盘没并进同一份档案')
if (list2.reviews[0].sections !== 2) throw new Error('应该 2 段，得到 ' + list2.reviews[0].sections)
console.log('并进同一份:', list2.reviews[0].id, '段数', list2.reviews[0].sections)

// 再复盘一次同样的内容：不重复追加
emit('s1', botMsg(reviewText))
emit('s1', endTurn())
const list3 = await listOf()
if (list3.reviews[0].sections !== 2) throw new Error('重复复盘又加了一段，段数=' + list3.reviews[0].sections)
console.log('重复复盘已去重，段数', list3.reviews[0].sections)

// 换一段内容再复盘：同一份文件里追加第二段复盘（总 3 段）
emit('s1', botMsg(reviewText.replace('去重', '合并')))
emit('s1', endTurn())
const list4 = await listOf()
if (list4.reviews[0].sections !== 3) throw new Error('新复盘没并进去，段数=' + list4.reviews[0].sections)

// 下一次普通对话：只更新「最近进展」，不新增段
emit('s1', userMsg('再补一句：PDF 要能直接打开，别只是落一个文件在磁盘上。'))
emit('s1', botMsg('已经能直接打开：点「打开」走 /reviews/file，content-type 是 application/pdf，浏览器内置阅读器直接渲染。'.repeat(4)))
emit('s1', endTurn())
const list5 = await listOf()
if (list5.reviews[0].sections !== 3) throw new Error('普通对话不该新增段，段数=' + list5.reviews[0].sections)

const mergedFile = await fileOf(auto.id)
if (mergedFile !== firstFile) throw new Error('同一会话换了文件路径：' + mergedFile)
// 文件是后台重新打印的，等它把新内容写进去
const mergedText = await waitFor(() => {
  try {
    const text = readFileSync2(mergedFile, 'utf8')
    return text.includes('PDF 要能直接打开') ? text : ''
  } catch (error) {
    return ''
  }
}, 8000)
if (mergedText === '') throw new Error('合并后的文件没更新')
if (!mergedText.includes('会话摘要') || !mergedText.includes('成功经验')) throw new Error('合并后的文件没有复盘正文')
if (!mergedText.includes('最近进展')) throw new Error('合并后丢了最近进展段')
if (!mergedText.includes('PDF 要能直接打开')) throw new Error('最近进展没跟着更新')
console.log('合并文件:', mergedFile.split(/[\\/]/).pop(), mergedText.length, '字')

// 重打是后台做的，等文件字段回填
const withFile = await waitFor(async () => {
  const now = await listOf()
  return now.reviews[0] && now.reviews[0].file ? now.reviews : null
}, 8000)
if (withFile === null) throw new Error('列表没带文件字段')
if (withFile[0].kind !== 'md') throw new Error('文件类型不对：' + withFile[0].kind)

// 面板「打开」走的就是这条：取文件本体
const fileRes = await call('/dsh-thinking-review/reviews/file', 'GET', '/dsh-thinking-review/reviews/file?id=' + encodeURIComponent(auto.id))
if (fileRes.code !== 200) throw new Error('取文件失败：' + fileRes.code + ' ' + fileRes.body)
if (String(fileRes.headers['content-type'] || '').indexOf('text/markdown') !== 0) throw new Error('content-type 不对：' + fileRes.headers['content-type'])
console.log('取文件 OK:', fileRes.headers['content-type'], fileRes.raw ? fileRes.raw.length : 0, '字节')

const missing = await call('/dsh-thinking-review/reviews/file', 'GET', '/dsh-thinking-review/reviews/file?id=nope')
if (missing.code !== 404) throw new Error('不存在的 id 应该 404，得到 ' + missing.code)

const item = JSON.parse((await call('/dsh-thinking-review/reviews/item', 'GET', '/dsh-thinking-review/reviews/item?id=' + encodeURIComponent(auto.id))).body)
if (!item.ok || !item.review.text.includes('会话摘要')) throw new Error('全文没取到')

// 太短的输出不落库，也不覆盖已有的最近进展
emit('s1', botMsg('太短'))
emit('s1', endTurn())
const afterShort = await listOf()
if (afterShort.reviews.length !== 1) throw new Error('短输出另起了档案')
if (!readFileSync2(mergedFile, 'utf8').includes('PDF 要能直接打开')) throw new Error('短输出覆盖了最近进展')

// 另一个会话：各自一份档案，互不干扰
emit('s3', userMsg('另一件事：把左侧导航里的「复盘经验」图标换成文件夹，16x16，描边别用填充。'))
emit('s3', botMsg('图标已经换成文件夹样式：viewBox 0 0 16 16，stroke 用 currentColor，strokeWidth 1.5，只画 path 不填充，跟着主题色走。'.repeat(2)))
emit('s3', endTurn())
const list6 = await listOf()
if (list6.reviews.length !== 2) throw new Error('不同会话应该各一条，条数=' + list6.reviews.length)
const other = list6.reviews.find((x) => x.sessionId === 's3')
if (!other || other.id === auto.id) throw new Error('不同会话共用了档案 id')
console.log('会话隔离 OK:', other.id)

// 删除
console.log('删除:', (await call('/dsh-thinking-review/reviews/delete', 'POST', '/dsh-thinking-review/reviews/delete', { id: auto.id })).body)
const afterDelete = await listOf()
if (afterDelete.reviews.length !== 1) throw new Error('删除没生效')
if (existsSync(mergedFile)) throw new Error('删除后文件还在：' + mergedFile)
console.log('删文件 OK')

// 重启后从文件恢复（此时文件里是 off）
const before = sections.length
mod.apply({ ...ctx, webServer: { register: () => () => {} } })
console.log('reboot 后未多挂:', sections.length === before)
console.log('SMOKE OK')

/**
 * dsh-thinking-review · Host 半边
 *
 * 两件事：
 *  1. 按会话记住「思考前澄清」开关（~/.dsh/dsh-thinking-review/state.json），
 *     并对打开的会话把一段提示词挂进系统提示词（agent.ctx.systemPrompt.section）。
 *  2. 给浏览器半边一组自己的 HTTP 路由，用来读写这个开关。
 *
 * 会话复盘（总结 + 写记忆）不需要 Host 参与：浏览器半边直接向当前会话发一条
 * 提示，模型自己总结、征得同意后调用 remember。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'dsh-thinking-review'
export const inject = ['webServer', 'agents']

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const STATE_DIR = join(DSH_HOME, 'dsh-thinking-review')
const STATE_PATH = join(STATE_DIR, 'state.json')
/** 改名前（dsh-clarify）的旧状态文件，只在新的不存在时读一次。 */
const LEGACY_STATE_PATH = join(DSH_HOME, 'dsh-clarify', 'state.json')
/** 复盘记录的存放位置：每条 = 一次「复盘本会话」的完整产出。 */
const REVIEWS_PATH = join(STATE_DIR, 'reviews.json')
const REVIEW_LIMIT = 500
/** 短于此长度的输出当闲聊/半截话，不落库。 */
const REVIEW_MIN_CHARS = 160
/** 点了复盘却一直没等到回复，超过这个时间就放弃这一条。 */
const REVIEW_PENDING_TTL = 15 * 60 * 1000

/** 系统提示词里这段的名字与位置。放在宿主那些大段说明（约到 10200）之后，
 *  免得开关一变就把整段长提示词的缓存打掉。 */
const SECTION_NAME = 'plugin:dsh-thinking-review'
const SECTION_ORDER = 89950

const SECTION_TEXT = [
  '【追问澄清 · 本会话已开启】',
  '用户在本会话里希望你先确认真懂了再动手。原理只有一句：追问是为了降低「做错事」的概率，所以只问——答案不同、做法就不同的问题。若所有可能答案都指向同一个做法，这问题的信息价值为零：不问，直接做。',
  '一、先找决策：这次请求最终会改变哪个决定或交付（改哪段代码、给谁看、先做还是先验）。说不出这个，本身就说明没听懂——这就是最该问的那一条。',
  '二、列出至少 3 种合理解读，其中一种必须是「用户没说全、我信息不足」；生成解读时把目标、完成标准、范围、约束、环境、可逆性这六个面都过一遍。对每种解读写下分离预测：若是这种解读，我会做的事有什么不同。',
  '三、只在解读「做法分岔」的地方提问；分岔小于「只改一句措辞」的，别问。问 1–3 个（硬上限 5 个），编号，每个带默认值和一眼能回的选择（回 defaults 即按默认）。优先问能一次砍掉最多分支的那条。',
  '四、提问那条消息里：不给最终方案、不边问边答、不自问自答。答案到之前只允许只读侦察（读文件、看配置），不写不改不提交。一查就知道的别问。',
  '五、答案到了：用 1–3 句复述 spec——目标、钉死的约束、明确不做的事、完成标准，再加一句「什么会让你改主意」。复述完直接开工，不再追问。',
  '六、交付时带一行边界：适用范围，以及什么证据会推翻这个做法。写不出边界，说明还没想清。',
  '七、用户说「别问了」「直接做」「停」「就这样」：立刻停，按当前理解开工，开头编号列出你采用的假设，并跟上那行边界。',
  '追问要短：不客套、不复述原话、不为凑问题而问。闲聊、typo、答案唯一的单点修改，直接做。',
].join('\n')

/** 会话 id 在 Session 对象上的字段名各家版本不完全一致，挨个试。 */
function sessionIdOf(session) {
  if (!session) return ''
  for (const key of ['id', 'sessionId', 'key', 'sessionKey', 'sid']) {
    try {
      const value = session[key]
      if (typeof value === 'string' && value.length > 0) return value
    } catch (error) {}
  }
  return ''
}

/** 派出去干活的子代理不挂这段提示词：它只做一件事，追问没有意义。 */
function isSubagent(agent) {
  try {
    const header = agent && agent.session && agent.session.header
    if (header && header.origin === 'subagent') return true
    if (header && typeof header.delegationDepth === 'number' && header.delegationDepth > 0) return true
  } catch (error) {}
  return false
}

function readStateFile(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    const out = new Set()
    const sessions = parsed && parsed.sessions ? parsed.sessions : {}
    for (const [sid, on] of Object.entries(sessions)) {
      if (on === true && typeof sid === 'string' && sid.length > 0) out.add(sid)
    }
    return out
  } catch (error) {
    return null
  }
}

function loadEnabled() {
  const own = readStateFile(STATE_PATH)
  if (own !== null) return own
  // 改名前的旧文件：迁过来，别让用户白开一遍。
  return readStateFile(LEGACY_STATE_PATH) || new Set()
}

function saveEnabled(enabled) {
  try {
    mkdirSync(dirname(STATE_PATH), { recursive: true })
    const sessions = {}
    for (const sid of enabled) sessions[sid] = true
    writeFileSync(STATE_PATH, JSON.stringify({ version: 1, sessions }, null, 2), 'utf8')
  } catch (error) {
    console.warn('[dsh-thinking-review] 保存开关失败：' + ((error && error.message) || error))
  }
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 64 * 1024) req.destroy()
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'))
      } catch (error) {
        resolve(null)
      }
    })
    req.on('error', () => resolve(null))
  })
}

/** 一条复盘记录的摘要：去掉 Markdown 标记，压成一行。 */
function summarizeReview(text) {
  const flat = String(text)
    .replace(/\r/g, '')
    .replace(/[#>*`\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (flat.length <= 160) return flat
  return flat.slice(0, 160) + '…'
}

function makeReviewId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
}

function readReviews() {
  try {
    const parsed = JSON.parse(readFileSync(REVIEWS_PATH, 'utf8'))
    const list = parsed && Array.isArray(parsed.reviews) ? parsed.reviews : []
    const out = []
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      if (typeof item.id !== 'string' || typeof item.text !== 'string') continue
      out.push({
        id: item.id,
        sessionId: typeof item.sessionId === 'string' ? item.sessionId : '',
        title: typeof item.title === 'string' ? item.title : '',
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
        summary: typeof item.summary === 'string' ? item.summary : summarizeReview(item.text),
        text: item.text,
        chars: item.text.length,
      })
    }
    return out.slice(0, REVIEW_LIMIT)
  } catch (error) {
    return []
  }
}

function saveReviews(list) {
  try {
    mkdirSync(dirname(REVIEWS_PATH), { recursive: true })
    writeFileSync(REVIEWS_PATH, JSON.stringify({ version: 1, reviews: list }, null, 2), 'utf8')
    return true
  } catch (error) {
    console.warn('[dsh-thinking-review] 保存复盘失败：' + ((error && error.message) || error))
    return false
  }
}

/** 列表用的瘦身版：不带全文，免得一屏几百条把响应撑大。 */
function reviewMeta(item) {
  return {
    id: item.id,
    sessionId: item.sessionId,
    title: item.title,
    createdAt: item.createdAt,
    summary: item.summary,
    chars: item.chars,
  }
}

export function apply(ctx) {
  const enabled = loadEnabled()
  /** sid → { agent, off } */
  const mounted = new Map()
  /** 已落库的复盘，新在前。 */
  const reviews = readReviews()
  /** sid → { startedAt, parts: string[] }：正在等这一轮「复盘」的输出。 */
  const pending = new Map()

  /** 服务可能还没装：取不到就当没有，别让插件起不来。 */
  function service(name) {
    try {
      if (typeof ctx.get === 'function') return ctx.get(name)
    } catch (error) {}
    return undefined
  }

  /** 会话标题只对加载过的会话可读，读不到就留空（面板显示短 id）。 */
  function resolveTitle(sid) {
    try {
      const sessions = service('sessions')
      const session = sessions && typeof sessions.get === 'function' ? sessions.get(sid) : undefined
      if (session) {
        try {
          const titles = service('sessionTitle')
          const snap = titles && typeof titles.get === 'function' ? titles.get(session) : undefined
          if (snap && typeof snap.title === 'string' && snap.title.trim() !== '') return snap.title.trim()
        } catch (error) {}
        if (typeof session.title === 'string' && session.title.trim() !== '') return session.title.trim()
        const header = session.header
        if (header && typeof header.title === 'string' && header.title.trim() !== '') return header.title.trim()
      }
    } catch (error) {}
    return ''
  }

  function prunePending() {
    const now = Date.now()
    for (const [sid, entry] of [...pending]) {
      if (now - entry.startedAt > REVIEW_PENDING_TTL) pending.delete(sid)
    }
  }

  function startPending(sid) {
    prunePending()
    pending.set(sid, { startedAt: Date.now(), parts: [] })
  }

  /** 一轮结束：够长就落库成一条复盘，否则丢掉。 */
  function finishPending(sid) {
    const entry = pending.get(sid)
    if (entry === undefined) return null
    pending.delete(sid)
    const text = entry.parts.join('\n\n').trim()
    if (text.length < REVIEW_MIN_CHARS) return null
    const record = {
      id: makeReviewId(),
      sessionId: sid,
      title: resolveTitle(sid),
      createdAt: new Date().toISOString(),
      summary: summarizeReview(text),
      text,
      chars: text.length,
    }
    reviews.unshift(record)
    if (reviews.length > REVIEW_LIMIT) reviews.length = REVIEW_LIMIT
    saveReviews(reviews)
    return record
  }

  /** 只收「点过复盘之后那一轮」的助手正文；别的轮次一律不碰。 */
  function onSessionEvent(session, event) {
    try {
      const sid = typeof session === 'string' ? session : sessionIdOf(session)
      if (sid === '') return
      const entry = pending.get(sid)
      if (entry === undefined) return
      const type = event && event.type
      if (type === 'assistant/message') {
        const data = event.data || {}
        if (data.interrupted === true) return
        const content = data.message && Array.isArray(data.message.content) ? data.message.content : []
        const chunks = []
        for (const block of content) {
          if (!block || block.type !== 'text') continue
          if (typeof block.text !== 'string') continue
          if (block.text.trim() === '') continue
          chunks.push(block.text)
        }
        if (chunks.length > 0) entry.parts.push(chunks.join('\n\n'))
        return
      }
      if (type === 'turn/end') {
        const saved = finishPending(sid)
        if (saved !== null) console.log('[dsh-thinking-review] 已记录复盘 ' + saved.id + '（' + saved.chars + ' 字）')
      }
    } catch (error) {}
  }

  function unmount(sid) {
    const entry = mounted.get(sid)
    if (entry === undefined) return
    mounted.delete(sid)
    try {
      // systemPrompt.section() 返回的是 Cordis 的 effect disposer（一个函数），
      // 不是 { off() } 对象。
      if (typeof entry.off === 'function') entry.off()
    } catch (error) {}
  }

  function mount(agent, sid) {
    const prompt = agent && agent.ctx ? agent.ctx.systemPrompt : undefined
    if (prompt === undefined || typeof prompt.section !== 'function') return false
    const off = prompt.section({
      name: SECTION_NAME,
      order: SECTION_ORDER,
      // 纯文本，别让宿主当模板解析（用户内容里带 {{ }} 会炸整轮请求）。
      interpolate: false,
      text: () => SECTION_TEXT,
    })
    mounted.set(sid, { agent, off })
    return true
  }

  function sync() {
    let agents = []
    try {
      agents = ctx.agents.list() || []
    } catch (error) {
      agents = []
    }
    const live = new Set()
    for (const agent of agents) {
      let sid = ''
      try {
        sid = sessionIdOf(agent && agent.session)
      } catch (error) {
        sid = ''
      }
      if (sid === '') continue
      if (isSubagent(agent)) continue
      live.add(sid)
      if (!enabled.has(sid)) {
        unmount(sid)
        continue
      }
      const entry = mounted.get(sid)
      // agent 实例会被换掉（重开会话、插件重载），记着实例才能补挂。
      if (entry !== undefined && entry.agent === agent) continue
      if (entry !== undefined) unmount(sid)
      try {
        mount(agent, sid)
      } catch (error) {
        console.warn('[dsh-thinking-review] 挂提示词失败：' + ((error && error.message) || error))
      }
    }
    for (const sid of [...mounted.keys()]) {
      if (!live.has(sid)) unmount(sid)
    }
  }

  function setEnabled(sid, on) {
    if (on) enabled.add(sid)
    else enabled.delete(sid)
    saveEnabled(enabled)
    sync()
    return enabled.has(sid)
  }

  sync()
  // 与宿主的 agent 生命周期对不上拍，就低频对齐一次。
  try {
    ctx.effect(() => ctx.interval(sync, 1000))
  } catch (error) {
    console.warn('[dsh-thinking-review] 定时器不可用：' + ((error && error.message) || error))
  }
  ctx.effect(() => () => {
    for (const sid of [...mounted.keys()]) unmount(sid)
  })

  // 复盘产出的捕获口：assistant/message 攒正文，turn/end 落库。
  try {
    ctx.effect(() => ctx.on('session/event', onSessionEvent, { global: true }))
  } catch (error) {
    console.warn('[dsh-thinking-review] 订阅会话事件失败：' + ((error && error.message) || error))
  }

  const route = (path, handler) =>
    ctx.effect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path,
        handler: async (req, res) => {
          const reply = (code, payload) => {
            try {
              res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
              res.end(JSON.stringify(payload))
            } catch (error) {}
          }
          try {
            await handler(req, res, reply)
          } catch (error) {
            reply(500, { ok: false, error: String((error && error.message) || error) })
          }
        },
      }),
    )

  route('/dsh-thinking-review/state', async (req, res, reply) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (req.method === 'POST') {
      const body = await readJsonBody(req)
      const sid = body && typeof body.session === 'string' ? body.session.trim() : ''
      if (sid === '') return reply(400, { ok: false, error: '缺少 session' })
      const on = body.enabled === true
      return reply(200, { ok: true, session: sid, enabled: setEnabled(sid, on) })
    }
    const sid = (url.searchParams.get('session') || '').trim()
    if (sid === '') return reply(400, { ok: false, error: '缺少 session' })
    return reply(200, { ok: true, session: sid, enabled: enabled.has(sid) })
  })

  // 诊断用：看看当前生效的提示词文本（改了文本后可以确认是否已重载）。
  route('/dsh-thinking-review/text', async (req, res, reply) => {
    reply(200, { ok: true, order: SECTION_ORDER, text: SECTION_TEXT })
  })

  // 诊断用：看看现在挂了哪些会话。
  route('/dsh-thinking-review/mounted', async (req, res, reply) => {
    reply(200, {
      ok: true,
      enabled: [...enabled],
      mounted: [...mounted.keys()],
      stateFile: STATE_PATH,
      reviewsFile: REVIEWS_PATH,
      reviews: reviews.length,
      pending: [...pending.keys()],
    })
  })

  // 点「复盘本会话」时先登记：Host 才知道接下来这一轮的输出要收进复盘列表。
  route('/dsh-thinking-review/reviews/request', async (req, res, reply) => {
    if (req.method !== 'POST') return reply(405, { ok: false, error: '只支持 POST' })
    const body = await readJsonBody(req)
    const sid = body && typeof body.session === 'string' ? body.session.trim() : ''
    if (sid === '') return reply(400, { ok: false, error: '缺少 session' })
    startPending(sid)
    return reply(200, { ok: true, session: sid, pending: [...pending.keys()] })
  })

  // 列表：不带全文，点开再用 /reviews/item 取。
  route('/dsh-thinking-review/reviews', async (req, res, reply) => {
    prunePending()
    return reply(200, {
      ok: true,
      reviews: reviews.map(reviewMeta),
      pending: [...pending.keys()],
      file: REVIEWS_PATH,
    })
  })

  route('/dsh-thinking-review/reviews/item', async (req, res, reply) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const id = (url.searchParams.get('id') || '').trim()
    const found = reviews.find((item) => item.id === id)
    if (found === undefined) return reply(404, { ok: false, error: '没有这条复盘' })
    return reply(200, { ok: true, review: found })
  })

  route('/dsh-thinking-review/reviews/delete', async (req, res, reply) => {
    if (req.method !== 'POST') return reply(405, { ok: false, error: '只支持 POST' })
    const body = await readJsonBody(req)
    const id = body && typeof body.id === 'string' ? body.id.trim() : ''
    if (id === '') return reply(400, { ok: false, error: '缺少 id' })
    const index = reviews.findIndex((item) => item.id === id)
    if (index === -1) return reply(404, { ok: false, error: '没有这条复盘' })
    reviews.splice(index, 1)
    saveReviews(reviews)
    return reply(200, { ok: true, deleted: id, count: reviews.length })
  })
}

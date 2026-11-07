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

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
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
/** 每条复盘落成的文件（<id>.pdf，浏览器不可用时退回 <id>.md）。 */
const REVIEWS_DIR = join(STATE_DIR, 'reviews')
/** Edge/Chrome 无头打印最多等这么久。 */
const PDF_TIMEOUT_MS = 25000
const REVIEW_LIMIT = 500
/** 短于此长度的输出当闲聊/半截话，不落库。 */
const REVIEW_MIN_CHARS = 160
/** 点了复盘却一直没等到回复，超过这个时间就放弃这一条。 */
const REVIEW_PENDING_TTL = 15 * 60 * 1000
/** 一个会话的档案里最多留几段（1 段「最近进展」+ 若干次复盘），超了丢最旧的。 */
const SESSION_SECTIONS_MAX = 12
/** 档案正文的硬上限，防止聊很久的会话把 PDF 撑到几百页。 */
const SESSION_TEXT_MAX = 80000
/** 自动存档时每条消息最多留这么多字，只做轮廓。 */
const SESSION_FIELD_MAX = 4000
/** 「经验库」：每三天把复盘里的结论 / 成功经验 / 候选记忆抽成条目，供提示词引用。 */
const LESSONS_PATH = join(STATE_DIR, 'lessons.json')
const LESSONS_MD_PATH = join(STATE_DIR, 'lessons.md')
const DIGEST_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000
const LESSON_LIMIT = 300
/** 一条经验最长多少字，超出截断（提示词里要短）。 */
const LESSON_TEXT_MAX = 240
/** 注入提示词时最多带几条、每条截多长。 */
const LESSON_INJECT_MAX = 8
const LESSON_INJECT_CHARS = 160

/** 系统提示词里这段的名字与位置。放在宿主那些大段说明（约到 10200）之后，
 *  免得开关一变就把整段长提示词的缓存打掉。 */
const SECTION_NAME = 'plugin:dsh-thinking-review'
const SECTION_ORDER = 89950
/** 「经验优先」是另一段提示词：同一会话可以只开这一个。 */
const EXPERIENCE_NAME = 'plugin:dsh-thinking-review:experience'
const EXPERIENCE_ORDER = 89960

const SECTION_TEXT = [
  "【追问澄清 · 本会话已开启】",
  "用户在本会话里希望你先确认真懂了再动手。默认动作是问，不是猜：一次短问答的代价远低于做错的代价。只有你能明确论证「所有可能答案都指向同一个做法、且代价相同」时，才不问——那种状态下问题的信息价值为零，直接做。举不出这个论证，就问。",
  "一、先找决策：这次请求最终会改变哪个决定或交付（改哪段代码、给谁看、先做还是先验）。说不出这个，本身就说明没听懂——这就是最该问的那一条。",
  "二、先扫这十个面，哪一面答不上来，哪一面就是该问的地方；能靠读文件、看代码、查配置自己弄清的，自己查完再判断，别拿它当问题问用户：",
  "  1 目标：要改变什么状态、给谁用、解决谁的什么问题。",
  "  2 交付物与格式：代码改动 / 文档 / 表格 / 图 / 命令；放哪、叫什么名、什么格式。",
  "  3 验收标准：怎么算做完、谁来验、看什么证据（测试过、能跑起来、截图、数字达标）。",
  "  4 范围与不做：动哪几个文件或模块，明确不碰什么（别顺手重构、别扩大改动）。",
  "  5 约束：技术栈与版本、必须复用或禁止引入的依赖、性能、兼容性、体积。",
  "  6 环境与权限：在哪台机器、哪个目录跑；能不能联网装包；能不能改配置、提交或写工作区外的文件。",
  "  7 数据与来源：输入从哪来、样例长什么样、精度或口径按哪套。",
  "  8 时间与优先级：先做哪块、能不能分批交、有没有截止。",
  "  9 可逆性：错了能不能回滚、要不要先备份、是不是不可逆操作。",
  "  10 既有约定：项目 AGENTS.md、现有命名与风格、以前定过的决定（先搜再问，问之前先确认自己没漏读）。",
  "三、做一次多维扫描：把同一件事在六个维度上各过一遍，每个维度产出一条「若成立就会改变做法」的判断；产不出判断的那个维度，就是理解还浅的地方，直接进你的提问清单：",
  "  1 对象维：谁用它、谁维护它、谁受影响、谁验收——通常不是同一个人，挨个替他们想一遍。",
  "  2 尺度维：这次是改一处、一个模块、还是一个系统？局部最优会不会让整体更差？",
  "  3 时间维：现在怎么跑、三个月后谁还在改它、要回滚时怎么退——这决定可逆成本。",
  "  4 因果维：为什么要做这件事、不做会怎样、真正的瓶颈在哪一环（别对着症状动手）。",
  "  5 反证维：先写下「什么证据会证明这个做法是错的」，再看现有信息能不能排除它；排除不了就是缺口。",
  "  6 二阶维：这个改动会让什么原本成立的东西不再成立、谁因此要改流程或改习惯。",
  "四、工具盘查（提问之前做一次，别等开工才发现缺东西）：把这件事要用的东西列出来——命令或 CLI、DSH 插件、MCP 服务、skill、外部账号；对照你手头的工具清单与技能目录逐项确认「有 / 没有」。要真查：看 package.json 与配置、看有没有对应 skill、必要时联网搜现成的插件或 CLI，别凭印象。",
  "五、缺的那个若真的非它不可，就把它做成提问里的一条：工具名 + 干什么用 + 现有工具为什么替代不了 + 装的代价（联网、装包、权限、体积、要不要重启），然后问「装 / 换替代 / 先不做」。能用手头工具拼出来的小步骤，不要推销安装。",
  "六、同意了就装：走该工具正常的安装方式，能装到项目本地就不装全局；装完立刻做一次最小可用的验证，把验证结果贴出来。装失败就说清卡在哪一步，回到替代方案，不许假装装好了。不装或装不了：给替代方案——现有工具组合绕过去 / 降级交付（少做哪一块、交付什么）/ 换一种实现，并把「因为缺 X，所以这里改成 Y」写进复述的 spec 与那行边界。",
  "七、列出至少 3 种合理解读，其中一种必须是「用户没说全、我信息不足」；对每种解读写下分离预测——预测至少要落在两个不同维度上（对象维不同、或时间维不同、或验收不同），只差措辞的不算一种解读。",
  "八、提问门槛：默认问，不问要举证。",
  "  · 只要有一个面或一个维度不清晰，而你又举不出「所有答案指向同一做法」，就直接问——主动提问优先于猜着做。别用「大概能猜对」「先做着看」当理由。",
  "  · 不清晰的面 ≥ 2 条：必须先问，不许直接开工；正好 1 条：也补一条轻量确认——尤其目标、验收标准、范围与不做这三面，任何一条含糊都问。",
  "  · 三档都算该问：拦路（不问必做错，先问）、分岔（做法分岔：答不同做法就不同，问）、塑形（影响观感、命名、迁移成本与后续维护，一次问清并给默认值）。不要只问第一档。",
  "  · 用户给了新信息、换了目标、进了新模块，就重扫十个面与六个维度，再判断要不要问；别只扫第一轮。",
  "  · 一次提问尽量覆盖不同维度，别三条都问同一个面；每条问题都要能说出「答错会差在哪」，说不出的删掉。",
  "九、怎么问：编号 1–3 条（硬上限 5 条），按「答错的代价 × 不确定性」从高到低排；每条 = 一句背景 + 可选项 + 默认值，并写「回 defaults 即按默认」；优先问能一次砍掉最多分支的那条。只是措辞级的分岔不问。",
  "十、提问那条消息里：不给最终方案、不边问边答、不自问自答。答案到之前只允许只读侦察（读文件、看配置），不写不改不提交。一查就知道的别问。",
  "十一、问题发出后，这一轮就到此为止，然后停住等答案：不写代码、不改文件、不预先执行、不自己填默认值往下走。用户一直不回就保持等待——别因为「过了一会儿」就把沉默当成同意，也别反复追问纠缠（同一轮问题只发一次，用户答了别的再问）。等多久都不改变这一点，只有用户明确说「按默认」「别问了」「直接做」「继续」才动，那时按第十五条办。",
  "十二、若用了带超时的交互问询，超时只表示没收到答案，不表示同意，也不表示要换默认值：仍然停住等，并在同一会话里说明还在等哪几条。",
  "十三、答案到了：用 1–3 句复述 spec——目标、钉死的约束、明确不做的事、完成标准，再加一句「什么会让你改主意」。复述完直接开工，不再追问。",
  "十四、交付时带一行边界：适用范围，以及什么证据会推翻这个做法。写不出边界，说明还没想清。",
  "十五、用户说「别问了」「直接做」「停」「就这样」：立刻停，按当前理解开工，开头编号列出你采用的假设（哪几个面没问、各按什么默认值），并跟上那行边界。",
  "追问要短：不客套、不复述原话、不把同一件事拆成几问。闲聊、typo、答案唯一的单点修改，直接做。",
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

/** 读 { [key]: {sid: true} } 形式的状态文件。文件不存在或坏了返回 null。 */
function readFlags(path, key) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    const out = new Set()
    const bag = parsed && parsed[key] ? parsed[key] : {}
    for (const [sid, on] of Object.entries(bag)) {
      if (on === true && typeof sid === 'string' && sid.length > 0) out.add(sid)
    }
    return out
  } catch (error) {
    return null
  }
}

function loadEnabled() {
  const own = readFlags(STATE_PATH, 'sessions')
  if (own !== null) return own
  // 改名前的旧文件：迁过来，别让用户白开一遍。
  return readFlags(LEGACY_STATE_PATH, 'sessions') || new Set()
}

function loadExperience() {
  return readFlags(STATE_PATH, 'experience') || new Set()
}

/** 两个开关都存同一个文件：sessions（追问澄清）、experience（经验优先）。 */
function saveFlags(enabled, experience) {
  try {
    mkdirSync(dirname(STATE_PATH), { recursive: true })
    const sessions = {}
    for (const sid of enabled) sessions[sid] = true
    const exp = {}
    for (const sid of experience) exp[sid] = true
    writeFileSync(STATE_PATH, JSON.stringify({ version: 2, sessions, experience: exp }, null, 2), 'utf8')
  } catch (error) {
    console.warn('[dsh-thinking-review] 保存开关失败：' + ((error && error.message) || error))
  }
}

function nowIso() {
  return new Date().toISOString()
}

/** 粗分词：ascii 词 + 汉字二元组。够用来做「像不像同一条经验」的判断。 */
function textTokens(text) {
  const out = new Set()
  const source = String(text).toLowerCase()
  for (const word of source.split(/[^a-z0-9_\u4e00-\u9fa5]+/)) {
    if (word === '') continue
    if (/^[a-z0-9_]+$/.test(word)) {
      if (word.length >= 3) out.add(word)
      continue
    }
    if (word.length === 1) continue
    for (let i = 0; i + 2 <= word.length; i += 1) out.add(word.slice(i, i + 2))
  }
  return out
}

function similarity(a, b) {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const token of a) {
    if (b.has(token)) shared += 1
  }
  const union = a.size + b.size - shared
  return union === 0 ? 0 : shared / union
}

/** 复盘里哪几种标题下面的条目值得当经验。 */
const LESSON_KINDS = {
  结论与决定: 'decision',
  结论: 'decision',
  成功经验: 'lesson',
  经验: 'lesson',
  候选长期记忆: 'memory',
  长期记忆: 'memory',
}

/** 从一份复盘正文里抽条目：只看「结论 / 成功经验 / 候选记忆」这几个标题下的列表项。 */
function extractLessonCandidates(text) {
  const out = []
  let kind = ''
  for (const raw of String(text).replace(/\r/g, '').split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    const heading = /^#{1,4}\s*(.+)$/.exec(line)
    if (heading !== null) {
      const title = heading[1].replace(/[*`]/g, '').trim()
      kind = ''
      for (const key of Object.keys(LESSON_KINDS)) {
        if (title.includes(key)) {
          kind = LESSON_KINDS[key]
          break
        }
      }
      continue
    }
    if (kind === '') continue
    const bullet = /^[-*+]\s+(.+)$/.exec(line) || /^\d+[.)]\s+(.+)$/.exec(line)
    if (bullet === null) continue
    let body = bullet[1].replace(/\*\*/g, '').replace(/`/g, '').trim()
    if (body.length < 8) continue
    if (body.length > LESSON_TEXT_MAX) body = body.slice(0, LESSON_TEXT_MAX - 1) + '…'
    out.push({ text: body, kind })
  }
  return out
}

/** 同一件事不要记两遍：近似条目合并，命中次数 +1。 */
function buildLessons(reviews, previous) {
  const lessons = []
  const vectors = []
  for (const item of reviews) {
    const chunks = []
    if (item.auto === true && item.sections.length > 0) {
      for (const section of item.sections) chunks.push(section.text)
    } else {
      chunks.push(item.text)
    }
    for (const chunk of chunks) {
      for (const candidate of extractLessonCandidates(chunk)) {
        const tokens = textTokens(candidate.text)
        let hit = -1
        for (let i = 0; i < lessons.length; i += 1) {
          if (similarity(tokens, vectors[i]) >= 0.55) {
            hit = i
            break
          }
        }
        const when = item.updatedAt || item.createdAt || nowIso()
        if (hit >= 0) {
          const target = lessons[hit]
          target.hits += 1
          if (candidate.text.length > target.text.length) target.text = candidate.text
          target.lastAt = when
          if (!target.sources.includes(item.id)) target.sources.push(item.id)
          continue
        }
        lessons.push({
          text: candidate.text,
          kind: candidate.kind,
          hits: 1,
          firstAt: item.createdAt || when,
          lastAt: when,
          sources: [item.id],
        })
        vectors.push(tokens)
      }
    }
  }
  // 这一轮没再出现的旧经验也留着（复盘被删了才自然消失），别每三天就把库洗一遍。
  for (const old of previous) {
    const tokens = textTokens(old.text)
    let known = false
    for (const vector of vectors) {
      if (similarity(tokens, vector) >= 0.55) {
        known = true
        break
      }
    }
    if (known) continue
    lessons.push({
      text: old.text,
      kind: old.kind,
      hits: old.hits || 1,
      firstAt: old.firstAt || nowIso(),
      lastAt: old.lastAt || nowIso(),
      sources: Array.isArray(old.sources) ? old.sources : [],
    })
    vectors.push(tokens)
  }
  lessons.sort((a, b) => b.hits - a.hits || String(b.lastAt).localeCompare(String(a.lastAt)))
  return lessons.slice(0, LESSON_LIMIT).map((item, index) => ({
    id: 'l' + String(index + 1),
    text: item.text,
    kind: item.kind,
    hits: item.hits,
    firstAt: item.firstAt,
    lastAt: item.lastAt,
    sources: item.sources.slice(0, 8),
  }))
}

function emptyLessons() {
  return { updatedAt: '', lastDigestAt: '', digestCount: 0, lessons: [] }
}

function readLessonsFile() {
  try {
    const parsed = JSON.parse(readFileSync(LESSONS_PATH, 'utf8'))
    const list = Array.isArray(parsed && parsed.lessons) ? parsed.lessons : []
    const lessons = []
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      if (typeof item.text !== 'string' || item.text === '') continue
      lessons.push({
        id: typeof item.id === 'string' ? item.id : 'l' + String(lessons.length + 1),
        text: item.text,
        kind: typeof item.kind === 'string' ? item.kind : 'lesson',
        hits: typeof item.hits === 'number' && item.hits > 0 ? item.hits : 1,
        firstAt: typeof item.firstAt === 'string' ? item.firstAt : '',
        lastAt: typeof item.lastAt === 'string' ? item.lastAt : '',
        sources: Array.isArray(item.sources) ? item.sources.filter((x) => typeof x === 'string') : [],
      })
    }
    return {
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
      lastDigestAt: typeof parsed.lastDigestAt === 'string' ? parsed.lastDigestAt : '',
      digestCount: typeof parsed.digestCount === 'number' ? parsed.digestCount : 0,
      lessons,
    }
  } catch (error) {
    return emptyLessons()
  }
}

function lessonsMarkdown(state) {
  const lines = ['# 复盘经验库', '']
  const stamp = state.updatedAt === '' ? '还没整理过' : new Date(state.updatedAt).toLocaleString('zh-CN', { hour12: false })
  lines.push('整理时间：' + stamp + ' · 共 ' + state.lessons.length + ' 条 · 整理次数 ' + state.digestCount)
  lines.push('')
  for (const lesson of state.lessons) {
    lines.push('- [' + lesson.id + '] ' + lesson.text + '（出现 ' + lesson.hits + ' 次）')
  }
  lines.push('')
  return lines.join('\n')
}

function saveLessons(state) {
  try {
    mkdirSync(dirname(LESSONS_PATH), { recursive: true })
    writeFileSync(LESSONS_PATH, JSON.stringify({ version: 1, ...state }, null, 2), 'utf8')
    writeFileSync(LESSONS_MD_PATH, lessonsMarkdown(state), 'utf8')
    return true
  } catch (error) {
    console.warn('[dsh-thinking-review] 保存经验库失败：' + ((error && error.message) || error))
    return false
  }
}

/** 相关度排序：先按与本轮语境的相似度，同样的给高分老经验。 */
function rankLessons(lessons, query) {
  const queryTokens = textTokens(query)
  const scored = lessons.map((lesson, index) => {
    const sim = queryTokens.size === 0 ? 0 : similarity(queryTokens, textTokens(lesson.text))
    return { lesson, index, score: sim * 10 + Math.min(lesson.hits || 1, 8) * 0.5 }
  })
  scored.sort((a, b) => b.score - a.score || a.index - b.index)
  return scored.map((item) => item.lesson)
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

/** 档案里的分段：kind = latest（每轮覆盖）| review（追加，同文去重）。 */
function readSections(list) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    if (typeof item.text !== 'string' || item.text.trim() === '') continue
    out.push({
      kind: item.kind === 'review' ? 'review' : 'latest',
      label: typeof item.label === 'string' ? item.label : '',
      at: typeof item.at === 'string' ? item.at : '',
      text: item.text,
    })
  }
  return out
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
        updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
        auto: item.auto === true,
        sections: readSections(item.sections),
        summary: typeof item.summary === 'string' ? item.summary : summarizeReview(item.text),
        text: item.text,
        chars: item.text.length,
        file: typeof item.file === 'string' ? item.file : '',
        kind: item.kind === 'pdf' || item.kind === 'md' ? item.kind : '',
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
    updatedAt: item.updatedAt || item.createdAt,
    auto: item.auto === true,
    sections: Array.isArray(item.sections) ? item.sections.length : 0,
    summary: item.summary,
    chars: item.chars,
    file: item.file || '',
    kind: item.kind || '',
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 极简 Markdown 转 HTML：标题、有序/无序列表、加粗、行内代码、段落。复盘够用。 */
function markdownToHtml(text) {
  const inline = (s) =>
    escapeHtml(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
  const lines = String(text).replace(/\r/g, '').split('\n')
  const out = []
  let list = ''
  const closeList = () => {
    if (list !== '') {
      out.push('</' + list + '>')
      list = ''
    }
  }
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    if (line.trim() === '') {
      closeList()
      continue
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading !== null) {
      closeList()
      const level = Math.min(4, heading[1].length + 1)
      out.push('<h' + level + '>' + inline(heading[2]) + '</h' + level + '>')
      continue
    }
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (ordered !== null || bullet !== null) {
      const wanted = ordered !== null ? 'ol' : 'ul'
      if (list !== wanted) {
        closeList()
        out.push('<' + wanted + '>')
        list = wanted
      }
      out.push('<li>' + inline(ordered !== null ? ordered[1] : bullet[1]) + '</li>')
      continue
    }
    closeList()
    out.push('<p>' + inline(line) + '</p>')
  }
  closeList()
  return out.join('\n')
}

/** 一整页 A4 的 HTML，交给浏览器打印成 PDF。 */
function buildReviewHtml(record) {
  const when = record.updatedAt || record.createdAt ? new Date(record.updatedAt || record.createdAt) : new Date()
  const stamp = Number.isNaN(when.getTime()) ? '' : when.toLocaleString('zh-CN', { hour12: false })
  const title = record.title || '会话复盘'
  const count = Array.isArray(record.sections) ? record.sections.length : 0
  const meta = [stamp, record.chars + ' 字']
  if (count > 1) meta.push('共 ' + count + ' 段')
  return [
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
    '<title>' + escapeHtml(title) + '</title><style>',
    '@page{size:A4;margin:18mm 16mm}',
    'body{font-family:"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif;font-size:10.5pt;line-height:1.7;color:#1a1a1a;margin:0}',
    'h1{font-size:17pt;margin:0 0 6px;font-weight:600}',
    'h2{font-size:13pt;margin:20px 0 6px;font-weight:600}',
    'h3{font-size:11.5pt;margin:14px 0 4px;font-weight:600}',
    'h4{font-size:10.5pt;margin:12px 0 4px}',
    '.meta{color:#666;font-size:9pt;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid #ddd}',
    'p{margin:6px 0}ul,ol{margin:6px 0;padding-left:22px}li{margin:3px 0}',
    'code{background:#f2f2f2;padding:1px 3px;border-radius:3px;font-size:9.5pt}',
    '</style></head><body>',
    '<h1>' + escapeHtml(title) + '</h1>',
    '<div class="meta">' + escapeHtml(meta.join(' · ')) + '</div>',
    markdownToHtml(record.text),
    '</body></html>',
  ].join('')
}

/** 本机浏览器：Edge 几乎每台 Windows 都有，Chrome 备选；找不到就退回写 Markdown。 */
function findBrowser() {
  const candidates = [
    process.env.DSH_THINKING_REVIEW_BROWSER || '',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]
  for (const item of candidates) {
    if (item !== '' && existsSync(item)) return item
  }
  return ''
}

/** 无头打印成 PDF。判定成功的唯一标准：PDF 文件写出来了。 */
function printToPdf(browser, htmlPath, pdfPath) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (ok) => {
      if (settled) return
      settled = true
      resolve(ok)
    }
    let child = null
    try {
      child = spawn(
        browser,
        [
          '--headless=new',
          '--disable-gpu',
          '--no-first-run',
          '--no-default-browser-check',
          '--user-data-dir=' + join(REVIEWS_DIR, '.browser'),
          '--no-pdf-header-footer',
          '--print-to-pdf=' + pdfPath,
          'file:///' + encodeURI(htmlPath.split(String.fromCharCode(92)).join('/')),
        ],
        { stdio: 'ignore', windowsHide: true },
      )
    } catch (error) {
      finish(false)
      return
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch (error) {}
      finish(existsSync(pdfPath))
    }, PDF_TIMEOUT_MS)
    child.on('error', () => {
      clearTimeout(timer)
      finish(false)
    })
    child.on('exit', () => {
      clearTimeout(timer)
      // 个别版本退出码非 0 但文件已写出，按文件算。
      finish(existsSync(pdfPath))
    })
  })
}

/** 把一条复盘落成文件。返回 { file, kind }，彻底失败返回 null。 */
async function createReviewFile(record) {
  try {
    mkdirSync(REVIEWS_DIR, { recursive: true })
    const htmlPath = join(REVIEWS_DIR, record.id + '.html')
    const pdfPath = join(REVIEWS_DIR, record.id + '.pdf')
    writeFileSync(htmlPath, buildReviewHtml(record), 'utf8')
    let ok = false
    const browser = findBrowser()
    if (browser !== '' && process.env.DSH_THINKING_REVIEW_NO_PDF !== '1') {
      ok = await printToPdf(browser, htmlPath, pdfPath)
    }
    // 调试用：留着 HTML 好截图核对排版。
    if (process.env.DSH_THINKING_REVIEW_KEEP_HTML !== '1') {
      try {
        unlinkSync(htmlPath)
      } catch (error) {}
    }
    if (ok) {
      try {
        if (readFileSync(pdfPath).length > 800) return { file: pdfPath, kind: 'pdf' }
      } catch (error) {}
    }
    try {
      unlinkSync(pdfPath)
    } catch (error) {}
    const mdPath = join(REVIEWS_DIR, record.id + '.md')
    writeFileSync(mdPath, record.text, 'utf8')
    return { file: mdPath, kind: 'md' }
  } catch (error) {
    console.warn('[dsh-thinking-review] 生成复盘文件失败：' + ((error && error.message) || error))
    return null
  }
}

export function apply(ctx) {
  const enabled = loadEnabled()
  /** 「经验优先」：本条会话动手前先匹配经验库。 */
  const experience = loadExperience()
  /** sid → { agent, clarify, experience, offs: Function[] } */
  const mounted = new Map()
  /** 经验库：每三天从复盘里整理一次。 */
  let lessonState = readLessonsFile()
  /** sid → 最近一条用户消息：给「经验优先」做相关度匹配用。 */
  const lastUser = new Map()
  /** 已落库的复盘，新在前。 */
  const reviews = readReviews()
  /** sid → { startedAt, parts: string[] }：正在等这一轮「复盘」的输出。 */
  const pending = new Map()
  /** sid → { user, answer }：这一轮刚攒到的用户诉求与最近一条回答。 */
  const turnBuffer = new Map()
  /** 正在生成文件的复盘 id，防止重复起浏览器进程。 */
  const building = new Set()
  /** 正在后台整理经验库，防止并发写。 */
  let digesting = false
  /** 打印期间内容又变了 → 打完再重打一次。 */
  const dirty = new Set()

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

  /** 一个会话的档案 id 固定：同一会话的每次复盘都覆盖同一个 PDF。 */
  function sessionRecordId(sid) {
    const tail = String(sid).replace(/[^A-Za-z0-9]/g, '').slice(-40)
    return 'session-' + (tail === '' ? 'x' : tail)
  }

  function sessionRecordOf(sid) {
    for (const item of reviews) {
      if (item.auto === true && item.sessionId === sid) return item
    }
    return null
  }

  function normalizeText(text) {
    return String(text).replace(/\s+/g, ' ').trim()
  }

  function stampNow() {
    return new Date().toLocaleString('zh-CN', { hour12: false })
  }

  /** 档案 → 一份 Markdown：标题 + 每段一个二级标题。 */
  function renderSession(record) {
    const out = ['# ' + (record.title || '会话复盘'), '']
    for (const section of record.sections) {
      out.push('## ' + (section.label || '复盘'))
      out.push('')
      out.push(section.text.trim())
      out.push('')
    }
    return out.join('\n').trim() + '\n'
  }

  /** 把一段文字并进这个会话的档案：latest 每轮覆盖，review 追加（同一段文字只留一份）。 */
  function upsertSession(sid, kind, text) {
    const body = String(text === undefined || text === null ? '' : text).trim()
    if (body === '') return null
    if (body.length < REVIEW_MIN_CHARS) return null
    let record = sessionRecordOf(sid)
    const title = resolveTitle(sid)
    if (record === null) {
      record = {
        id: sessionRecordId(sid),
        sessionId: sid,
        title: title,
        createdAt: new Date().toISOString(),
        updatedAt: '',
        auto: true,
        sections: [],
        text: '',
        summary: '',
        chars: 0,
        file: '',
        kind: '',
      }
      reviews.unshift(record)
    }
    if (title !== '' && record.title !== title) record.title = title
    const fingerprint = normalizeText(body)
    const label = kind === 'review' ? '复盘 · ' + stampNow() : '最近进展（自动存档）'
    let index = -1
    for (let i = 0; i < record.sections.length; i += 1) {
      const section = record.sections[i]
      if (section.kind !== kind) continue
      if (kind === 'latest' || normalizeText(section.text) === fingerprint) {
        index = i
        break
      }
    }
    if (index >= 0) {
      const section = record.sections[index]
      const same = normalizeText(section.text) === fingerprint
      if (same && record.file !== '' && existsSync(record.file)) return record
      section.text = body
      section.label = label
      section.at = new Date().toISOString()
    } else {
      const section = { kind: kind, label: label, at: new Date().toISOString(), text: body }
      if (kind === 'latest') record.sections.unshift(section)
      else record.sections.push(section)
    }
    const latest = []
    const others = []
    for (const section of record.sections) {
      if (section.kind === 'latest') latest.push(section)
      else others.push(section)
    }
    // 太长的会话只留最近几段，免得 PDF 变成几百页。
    while (others.length > SESSION_SECTIONS_MAX - 1) others.shift()
    record.sections = latest.concat(others)
    const rendered = renderSession(record)
    const clipped = rendered.length > SESSION_TEXT_MAX ? rendered.slice(rendered.length - SESSION_TEXT_MAX) : rendered
    const changed = clipped !== record.text
    record.text = clipped
    record.chars = clipped.length
    record.summary = summarizeReview(body)
    record.updatedAt = new Date().toISOString()
    if (reviews.length > REVIEW_LIMIT) reviews.length = REVIEW_LIMIT
    saveReviews(reviews)
    if (changed) {
      // 同一份档案换了内容：旧 PDF 作废，重新打印并覆盖同一个文件。
      record.file = ''
      record.kind = ''
      ensureFile(record, true)
    } else if (record.file === '' || !existsSync(record.file)) {
      ensureFile(record)
    }
    return record
  }

  /**
   * record → 文件。正在打印时不再起第二个进程，但会记一笔 dirty：
   * 打完发现内容又变了，就按最新内容再打一次，保证磁盘上永远是最后一版。
   */
  function ensureFile(record, force) {
    if (!force && record.file !== '' && existsSync(record.file)) return
    if (building.has(record.id)) {
      if (force) dirty.add(record.id)
      return
    }
    building.add(record.id)
    dirty.delete(record.id)
    createReviewFile(record)
      .then((info) => {
        if (info === null) return
        record.file = info.file
        record.kind = info.kind
        saveReviews(reviews)
        console.log('[dsh-thinking-review] 复盘文件已生成 ' + info.kind + ' ' + info.file)
      })
      .catch((error) => {
        console.warn('[dsh-thinking-review] 打印复盘文件失败：' + ((error && error.message) || error))
      })
      .then(() => {
        building.delete(record.id)
        if (!dirty.has(record.id)) return
        dirty.delete(record.id)
        const latestRecord = reviews.find((item) => item.id === record.id)
        if (latestRecord !== undefined) ensureFile(latestRecord, true)
      })
  }

  /** 一条消息里的正文块（user 和 assistant 的形状一样）。 */
  function messageText(data) {
    const message = data && data.message
    const content = message && Array.isArray(message.content) ? message.content : null
    if (content !== null) {
      const chunks = []
      for (const block of content) {
        if (!block || block.type !== 'text') continue
        if (typeof block.text !== 'string') continue
        if (block.text.trim() === '') continue
        chunks.push(block.text)
      }
      if (chunks.length > 0) return chunks.join('\n\n').trim()
    }
    if (data && typeof data.text === 'string') return data.text.trim()
    return ''
  }

  /** 认得出「这就是一次复盘」的产出：有会话摘要，还有成功经验或候选记忆。 */
  function isReviewText(text) {
    const body = String(text)
    if (body.length < REVIEW_MIN_CHARS) return false
    return body.includes('会话摘要') && (body.includes('成功经验') || body.includes('候选长期记忆'))
  }

  function buildLatestText(buffer) {
    const parts = []
    if (buffer.user !== '') parts.push('**用户诉求**\n\n' + buffer.user)
    if (buffer.answer !== '') parts.push('**最近回答**\n\n' + buffer.answer)
    return parts.join('\n\n')
  }

  /**
   * 每一轮都收：用户诉求 + 最近回答写进这个会话档案的「最近进展」段（覆盖式）；
   * 如果这一轮产出的是一次完整复盘，就作为独立一段追加进去（同文只留一份）。
   */
  function onSessionEvent(session, event) {
    try {
      const sid = typeof session === 'string' ? session : sessionIdOf(session)
      if (sid === '') return
      const type = event && event.type
      const data = (event && event.data) || {}
      if (type === 'user/message') {
        const text = messageText(data).slice(0, SESSION_FIELD_MAX)
        if (text === '') return
        const buffer = turnBuffer.get(sid) || { user: '', answer: '' }
        buffer.user = text
        turnBuffer.set(sid, buffer)
        // 给「经验优先」做相关度匹配：只留最近一条诉求的样子。
        lastUser.set(sid, text.slice(0, 1200))
        return
      }
      if (type === 'assistant/message') {
        if (data.interrupted === true) return
        const text = messageText(data).slice(0, SESSION_FIELD_MAX)
        if (text === '') return
        const buffer = turnBuffer.get(sid) || { user: '', answer: '' }
        buffer.answer = text
        turnBuffer.set(sid, buffer)
        const entry = pending.get(sid)
        if (entry !== undefined) entry.parts.push(text)
        return
      }
      if (type !== 'turn/end') return
      const buffer = turnBuffer.get(sid)
      turnBuffer.delete(sid)
      const entry = pending.get(sid)
      pending.delete(sid)
      const forced = entry !== undefined
      let reviewText = buffer === undefined ? '' : buffer.answer
      if (forced) {
        const joined = entry.parts.join('\n\n').trim()
        if (joined.length > reviewText.length) reviewText = joined
      }
      if (isReviewText(reviewText) || (forced && reviewText.length >= REVIEW_MIN_CHARS)) {
        const record = upsertSession(sid, 'review', reviewText)
        if (record !== null) console.log('[dsh-thinking-review] 已并入复盘 ' + record.id + '（' + record.chars + ' 字）')
        return
      }
      if (buffer === undefined) return
      upsertSession(sid, 'latest', buildLatestText(buffer))
    } catch (error) {}
  }

  /** 整理经验库：读全部复盘 → 抽条目 → 去重合并 → 落盘（json + md）。 */
  function digestNow(reason) {
    if (digesting) return lessonState
    digesting = true
    try {
      const lessons = buildLessons(reviews, lessonState.lessons)
      lessonState = {
        updatedAt: nowIso(),
        lastDigestAt: nowIso(),
        digestCount: (lessonState.digestCount || 0) + 1,
        lessons: lessons,
      }
      saveLessons(lessonState)
      console.log('[dsh-thinking-review] 经验库已整理 ' + lessons.length + ' 条（' + reason + '）')
    } catch (error) {
      console.warn('[dsh-thinking-review] 整理经验库失败：' + ((error && error.message) || error))
    } finally {
      digesting = false
    }
    return lessonState
  }

  /** 三天一次；没整理过的、或到点了就重来一遍。 */
  function maybeDigest() {
    if (reviews.length === 0) return lessonState
    const last = Date.parse(lessonState.lastDigestAt || '')
    if (!Number.isFinite(last)) return digestNow('首次')
    if (Date.now() - last >= DIGEST_INTERVAL_MS) return digestNow('三天到期')
    return lessonState
  }

  /** 「经验优先」注入的提示词：规则 + 按相关度挑出的前几条经验。 */
  function experienceText(sid) {
    const query = [resolveTitle(sid), lastUser.get(sid) || ''].join(' ').trim()
    const picked = rankLessons(lessonState.lessons, query).slice(0, LESSON_INJECT_MAX)
    const lines = [
      '【经验优先 · 本会话已开启】',
      '用户要求本会话先看复盘经验再动手。规则：',
      '一、动手之前先在这份经验库里找相似场景（同一类任务、同一类坑、同一个工具、同一种交付物）。找到就用：在回答里写「经验 ' + (picked.length > 0 ? picked[0].id : 'l1') + '」，一句话说清它这次的适用条件，再按它调整做法。',
      '二、经验是先验不是证据：与当前代码、文档、用户新要求冲突时以证据为准，并写明「哪条经验因此不适用」，不要为了用经验而套。',
      '三、没有相似经验就说一句「经验库里没有相似场景」，按常规流程做，别硬套。',
      '四、收尾自检：这次踩到的坑以前记过没有？记过就说明为什么又踩、下次怎么提前拦住。',
    ]
    if (picked.length === 0) {
      lines.push('', '经验库当前为空（还没整理过，或还没有复盘条目）。照常做，不要编造经验。')
      return lines.join('\n')
    }
    const stamp = lessonState.updatedAt === '' ? '' : '，整理于 ' + new Date(lessonState.updatedAt).toLocaleString('zh-CN', { hour12: false })
    lines.push('', '经验库共 ' + lessonState.lessons.length + ' 条' + stamp + '，按与本轮诉求的相关度取前 ' + picked.length + ' 条：')
    for (const lesson of picked) {
      const text = lesson.text.length > LESSON_INJECT_CHARS ? lesson.text.slice(0, LESSON_INJECT_CHARS - 1) + '…' : lesson.text
      lines.push('  [' + lesson.id + '] ' + text)
    }
    return lines.join('\n')
  }

  function unmount(sid) {
    const entry = mounted.get(sid)
    if (entry === undefined) return
    mounted.delete(sid)
    for (const off of entry.offs) {
      try {
        // systemPrompt.section() 返回的是 Cordis 的 effect disposer（一个函数），
        // 不是 { off() } 对象。
        if (typeof off === 'function') off()
      } catch (error) {}
    }
  }

  function mountAll(agent, sid, wantClarify, wantExperience) {
    const prompt = agent && agent.ctx ? agent.ctx.systemPrompt : undefined
    if (prompt === undefined || typeof prompt.section !== 'function') return false
    const offs = []
    // 纯文本，别让宿主当模板解析（用户内容里带 {{ }} 会炸整轮请求）。
    if (wantClarify) {
      offs.push(prompt.section({ name: SECTION_NAME, order: SECTION_ORDER, interpolate: false, text: () => SECTION_TEXT }))
    }
    if (wantExperience) {
      offs.push(prompt.section({ name: EXPERIENCE_NAME, order: EXPERIENCE_ORDER, interpolate: false, text: () => experienceText(sid) }))
    }
    if (offs.length === 0) return false
    mounted.set(sid, { agent, clarify: wantClarify, experience: wantExperience, offs })
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
      const wantClarify = enabled.has(sid)
      const wantExperience = experience.has(sid)
      if (!wantClarify && !wantExperience) {
        unmount(sid)
        continue
      }
      const entry = mounted.get(sid)
      // agent 实例会被换掉（重开会话、插件重载），开关组合变了也要重挂。
      if (entry !== undefined && entry.agent === agent && entry.clarify === wantClarify && entry.experience === wantExperience) continue
      if (entry !== undefined) unmount(sid)
      try {
        mountAll(agent, sid, wantClarify, wantExperience)
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
    saveFlags(enabled, experience)
    sync()
    return enabled.has(sid)
  }

  function setExperience(sid, on) {
    if (on) experience.add(sid)
    else experience.delete(sid)
    saveFlags(enabled, experience)
    sync()
    return experience.has(sid)
  }

  sync()
  // 与宿主的 agent 生命周期对不上拍，就低频对齐一次。
  try {
    ctx.effect(() => ctx.interval(sync, 1000))
  } catch (error) {
    console.warn('[dsh-thinking-review] 定时器不可用：' + ((error && error.message) || error))
  }
  // 经验库：启动时补一次（可能已过三天），之后每半小时看看到点没有。
  try {
    maybeDigest()
  } catch (error) {}
  try {
    ctx.effect(() => ctx.interval(maybeDigest, 30 * 60 * 1000))
  } catch (error) {
    console.warn('[dsh-thinking-review] 经验库定时器不可用：' + ((error && error.message) || error))
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

  // 「经验优先」开关：与追问澄清同一个状态文件，另一个键。
  route('/dsh-thinking-review/experience/state', async (req, res, reply) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (req.method === 'POST') {
      const body = await readJsonBody(req)
      const sid = body && typeof body.session === 'string' ? body.session.trim() : ''
      if (sid === '') return reply(400, { ok: false, error: '缺少 session' })
      return reply(200, { ok: true, session: sid, enabled: setExperience(sid, body.enabled === true) })
    }
    const sid = (url.searchParams.get('session') || '').trim()
    if (sid === '') return reply(400, { ok: false, error: '缺少 session' })
    return reply(200, { ok: true, session: sid, enabled: experience.has(sid) })
  })

  // 诊断用：看看当前生效的提示词文本（改了文本后可以确认是否已重载）。
  route('/dsh-thinking-review/text', async (req, res, reply) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const sid = (url.searchParams.get('session') || '').trim()
    reply(200, {
      ok: true,
      order: SECTION_ORDER,
      text: SECTION_TEXT,
      experienceOrder: EXPERIENCE_ORDER,
      experience: sid === '' ? '' : experienceText(sid),
    })
  })

  // 经验库：面板读这份列表；?q= 做一次相关度检索。
  route('/dsh-thinking-review/lessons', async (req, res, reply) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const query = (url.searchParams.get('q') || '').trim()
    const list = query === '' ? lessonState.lessons : rankLessons(lessonState.lessons, query)
    const limit = Math.min(300, Math.max(1, Number(url.searchParams.get('limit')) || 100))
    return reply(200, {
      ok: true,
      updatedAt: lessonState.updatedAt,
      lastDigestAt: lessonState.lastDigestAt,
      digestCount: lessonState.digestCount,
      intervalMs: DIGEST_INTERVAL_MS,
      total: lessonState.lessons.length,
      lessons: list.slice(0, limit),
      file: LESSONS_PATH,
    })
  })

  // 立即整理一次（面板上的按钮）；不带 force 也允许，反正是空闲时重算。
  route('/dsh-thinking-review/lessons/digest', async (req, res, reply) => {
    if (req.method !== 'POST') return reply(405, { ok: false, error: '只支持 POST' })
    const state = digestNow('手动')
    return reply(200, { ok: true, updatedAt: state.updatedAt, total: state.lessons.length, digestCount: state.digestCount })
  })

  // 诊断用：看看现在挂了哪些会话。
  route('/dsh-thinking-review/mounted', async (req, res, reply) => {
    reply(200, {
      ok: true,
      enabled: [...enabled],
      experience: [...experience],
      mounted: [...mounted.keys()],
      lessons: { total: lessonState.lessons.length, updatedAt: lessonState.updatedAt, lastDigestAt: lessonState.lastDigestAt, digestCount: lessonState.digestCount, file: LESSONS_PATH },
      stateFile: STATE_PATH,
      reviewsFile: REVIEWS_PATH,
      reviewsDir: REVIEWS_DIR,
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
    // 上次没生成成功（浏览器忙/被沙箱拦）的，顺手补一遍。
    for (const item of reviews) ensureFile(item)
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

  // 打开一条复盘的文件：PDF 直接流给浏览器看，?download=1 变成下载。
  route('/dsh-thinking-review/reviews/file', async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const id = (url.searchParams.get('id') || '').trim()
    const send = (code, text) => {
      try {
        res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
        res.end(text)
      } catch (error) {}
    }
    const found = reviews.find((item) => item.id === id)
    if (found === undefined) return send(404, '没有这条复盘')
    const file = typeof found.file === 'string' ? found.file : ''
    if (file === '' || !existsSync(file)) {
      ensureFile(found)
      return send(409, '文件还在生成，几秒后再打开')
    }
    if (!file.startsWith(REVIEWS_DIR)) return send(403, '路径不合法')
    let bytes = null
    try {
      bytes = readFileSync(file)
    } catch (error) {
      return send(404, '文件读不出来')
    }
    const isPdf = found.kind === 'pdf' || file.endsWith('.pdf')
    const name = 'review-' + found.id + (isPdf ? '.pdf' : '.md')
    const disposition = url.searchParams.get('download') === '1' ? 'attachment' : 'inline'
    try {
      res.writeHead(200, {
        'content-type': isPdf ? 'application/pdf' : 'text/markdown; charset=utf-8',
        'content-length': bytes.length,
        'content-disposition': disposition + '; filename="' + name + '"',
        'cache-control': 'no-store',
      })
      res.end(bytes)
    } catch (error) {}
  })

  route('/dsh-thinking-review/reviews/delete', async (req, res, reply) => {
    if (req.method !== 'POST') return reply(405, { ok: false, error: '只支持 POST' })
    const body = await readJsonBody(req)
    const id = body && typeof body.id === 'string' ? body.id.trim() : ''
    if (id === '') return reply(400, { ok: false, error: '缺少 id' })
    const index = reviews.findIndex((item) => item.id === id)
    if (index === -1) return reply(404, { ok: false, error: '没有这条复盘' })
    const [gone] = reviews.splice(index, 1)
    saveReviews(reviews)
    if (gone && typeof gone.file === 'string' && gone.file !== '') {
      try {
        unlinkSync(gone.file)
      } catch (error) {}
    }
    return reply(200, { ok: true, deleted: id, count: reviews.length })
  })
}

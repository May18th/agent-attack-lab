import { parseSseData, reconnectDelay } from './command-center-stream'
import {
  buildBattleVisualizations,
  LiveBattleLifecycleProjector,
  LiveBattleTimelineProjector,
  type BattleVisualizationRound,
} from './command-center-visualizations'

type Difficulty = 'low' | 'mid' | 'high'

type Sample = {
  type?: string
  topic?: string
  severity?: string
  content?: string
  testCaseId?: string
  scenario?: string
  objective?: string
  simulation?: boolean
}

type DefenseItem = { reason?: string; type?: string; level?: string; action?: string; status?: string }
type Defense = {
  agentSource?: string
  caught?: DefenseItem[]
  risks?: DefenseItem[]
  fixed?: DefenseItem[]
  verificationStatus?: string
  scopeNotice?: string
}

type RoundScoreCategory = {
  id?: string
  label?: string
  score?: number | null
  maxScore?: number
  group?: string
}

type RoundScoreRole = {
  score?: number | null
  maxScore?: number
  categories?: RoundScoreCategory[]
  summary?: {
    processScore?: number
    effectScore?: number
    responseScore?: number
    baseScore?: number
    finalScore?: number
  }
}

type BattleRoundScore = {
  round: number
  attacker?: RoundScoreRole
  defender?: RoundScoreRole
}

type Battle = {
  id: string
  difficulty: Difficulty
  topic: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  rounds?: number
  createdAt: string
  attackerOut: { agentSource?: string; samples?: Sample[] }
  defenderOut: Defense[]
}

type BattleEvent = {
  id: string
  battleId: string
  sequence: number
  type: string
  status: string
  createdAt: string
  data: Record<string, unknown>
}

type Summary = {
  totalBattles: number
  sampleCount: number
  ruleHitCount: number
  riskCount: number
  ruleLibraryCaseCount: number
  acpCallBattles: number
}

type SessionStatus = { enabled: boolean; authenticated: boolean }
type ApiErrorBody = { detail?: unknown }
type BattleBus = {
  emit: (event: Record<string, unknown>) => boolean
  reset: (battleId?: string) => void
  setMode: (mode: 'live' | 'mock') => void
}

declare global {
  interface Window { BattleEventBus?: BattleBus }
}

const configuredApi = import.meta.env.VITE_AGENT_API?.trim()
// 正式站点下纠正被注入的预览 API：
// 构建脚本按 CF_PAGES_BRANCH 判定生产/预览，分支不是 main 时会落到 preview-api。
// 只对正式站点域名生效，预览子域的隔离语义不变。
const productionHosts = new Set(['yuanyiagentzhandui.cn', 'www.yuanyiagentzhandui.cn'])
const isProductionHost = productionHosts.has(location.hostname)
const normalizedApi =
  isProductionHost && configuredApi?.includes('preview-api')
    ? 'https://api.yuanyiagentzhandui.cn'
    : configuredApi
const API_BASE = (normalizedApi || (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  ? 'http://127.0.0.1:8787'
  : 'https://api.yuanyiagentzhandui.cn')).replace(/\/$/, '')
const PAGE_SIZE = 10
const difficultyText: Record<Difficulty, string> = { low: '低', mid: '中', high: '高' }
const sourceText: Record<string, string> = {
  'acp-llm': '独立 Agent（模型生成）',
  'acp-rule-fallback': '独立 Agent（规则兜底）',
  'local-rule': '本地规则引擎',
}

const state = {
  page: 0,
  total: 0,
  query: '',
  difficulty: '' as '' | Difficulty,
  selected: null as Battle | null,
  streamAbort: null as AbortController | null,
  streamSeen: new Set<string>(),
  sessionEnabled: false,
  authenticated: false,
  guestMode: false,
  starting: false,
  searchTimer: 0,
  requestedRounds: 3,
}

let visualizationRequestGeneration = 0
let liveTimelineProjector = new LiveBattleTimelineProjector()
let liveLifecycleProjector = new LiveBattleLifecycleProjector()
type TimelinePlaybackItem = { ready: Promise<void>; render: () => void }
type ThreePlaybackItem = { event: BattleEvent; round: number; resolve: () => void }
let slowPlayback = false
let timelinePlaybackQueue: TimelinePlaybackItem[] = []
let timelinePlaybackRunning = false
const pendingAnimationResolvers = new Set<() => void>()
let threePlaybackQueue: ThreePlaybackItem[] = []
let threePlaybackRunning = false
type LiveRoundScore = {
  attacker: number | null
  defender: number | null
  attackerRole?: RoundScoreRole
  defenderRole?: RoundScoreRole
}
const liveRoundScores = new Map<number, LiveRoundScore>()

function animationWindowMs(type: string) {
  if (type.includes('layer')) return 1100
  if (type.includes('verdict') || type.includes('similarity')) return 950
  if (type.includes('sample') || type.includes('stage')) return 850
  if (type.includes('settled') || type.includes('scored')) return 950
  return 750
}

function waitFor3dAnimation(type: string): Promise<void> {
  if (!slowPlayback) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = () => {
      window.clearTimeout(timer)
      pendingAnimationResolvers.delete(finish)
      resolve()
    }
    const timer = window.setTimeout(finish, animationWindowMs(type))
    pendingAnimationResolvers.add(finish)
  })
}

function drain3dPlayback() {
  if (threePlaybackRunning) return
  threePlaybackRunning = true
  void (async () => {
    while (threePlaybackQueue.length) {
      const item = threePlaybackQueue.shift()!
      emit3dEvent(item.event, item.round)
      if (slowPlayback) await waitFor3dAnimation(item.event.type)
      item.resolve()
    }
    threePlaybackRunning = false
  })()
}

function drainTimelinePlayback() {
  if (timelinePlaybackRunning) return
  timelinePlaybackRunning = true
  void (async () => {
    while (timelinePlaybackQueue.length) {
      const item = timelinePlaybackQueue.shift()!
      if (slowPlayback) await item.ready
      item.render()
    }
    timelinePlaybackRunning = false
  })()
}

function enqueueTimelinePlayback(render: () => void, ready: Promise<void>) {
  timelinePlaybackQueue.push({ render, ready })
  drainTimelinePlayback()
}

function setSlowPlayback(enabled: boolean) {
  slowPlayback = enabled
  if (!enabled) {
    pendingAnimationResolvers.forEach((resolve) => resolve())
    drain3dPlayback()
    drainTimelinePlayback()
  }
}

async function waitForTimelinePlayback() {
  while (timelinePlaybackRunning || timelinePlaybackQueue.length || threePlaybackRunning || threePlaybackQueue.length) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 20))
  }
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id)
  if (!value) throw new Error(`Missing element #${id}`)
  return value as T
}

function showToast(message: string, duration = 3200) {
  const toast = element<HTMLDivElement>('toast')
  toast.textContent = message
  toast.classList.add('show')
  window.setTimeout(() => toast.classList.remove('show'), duration)
}

function formatTime(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

function text(value: unknown) {
  return value == null || value === '' ? '—' : String(value)
}

function sourceLabel(source?: string) {
  return source ? sourceText[source] ?? `未知来源（${source}）` : '来源未记录'
}

function detailMessage(detail: unknown) {
  if (typeof detail === 'string') return detail
  if (!Array.isArray(detail)) return ''
  return detail.map((item) => item && typeof item === 'object' && 'msg' in item ? String(item.msg) : '').filter(Boolean).join('；')
}

class ApiError extends Error {
  readonly status: number
  readonly requestId?: string

  constructor(status: number, message: string, requestId?: string) {
    super(message)
    this.status = status
    this.requestId = requestId
  }
}

async function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('Accept', init.headers && headers.has('Accept') ? headers.get('Accept')! : 'application/json')
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, credentials: 'include', headers, cache: 'no-store' })
  } catch {
    throw new ApiError(0, '无法连接后端服务，请检查 API 域名、Tunnel 和网络状态')
  }
  if (!response.ok) {
    let detail = ''
    try { detail = detailMessage((await response.json() as ApiErrorBody).detail) } catch { /* gateway response */ }
    const fallback = response.status === 401 ? '登录已失效，请重新登录'
      : response.status === 403 ? '当前浏览器来源未获后端授权'
        : response.status === 404 ? '请求的数据不存在'
          : response.status === 422 ? '输入内容不符合后端要求'
            : response.status === 429 ? '操作过于频繁，请稍后重试'
              : response.status >= 500 ? '后端服务暂时不可用' : `请求失败（HTTP ${response.status}）`
    throw new ApiError(response.status, detail || fallback, response.headers.get('X-Request-ID') || undefined)
  }
  return response
}

async function json<T>(path: string, init?: RequestInit) {
  const response = await request(path, init)
  try { return await response.json() as T } catch { throw new ApiError(response.status, '后端返回了无效 JSON') }
}

function errorText(error: unknown) {
  if (error instanceof ApiError) return `${error.message}${error.requestId ? `（请求编号：${error.requestId}）` : ''}`
  return error instanceof Error ? error.message : '操作失败，请稍后重试'
}

function intercept(target: EventTarget, type: string, handler: (event: Event) => void) {
  target.addEventListener(type, (event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    handler(event)
  }, true)
}

function installSessionDialog() {
  if (document.getElementById('agentLoginMask')) return
  const style = document.createElement('style')
  style.textContent = `
    .agent-login-mask{position:fixed;inset:0;z-index:2000;display:none;align-items:center;justify-content:center;padding:20px;background:radial-gradient(ellipse at 50% 45%,rgba(23,85,133,.2),transparent 48%),rgba(2,5,12,.82);backdrop-filter:blur(12px)}
    .agent-login-mask.open{display:flex}.agent-login-box{position:relative;isolation:isolate;overflow:hidden;width:min(460px,100%);border:1px solid rgba(91,151,196,.48);border-radius:12px;background:linear-gradient(145deg,rgba(18,29,44,.98),rgba(9,16,27,.98));padding:28px;box-shadow:0 24px 80px rgba(0,0,0,.68),0 0 38px rgba(29,125,194,.14),inset 0 1px rgba(205,232,255,.08)}
    .agent-login-box:before{content:"";position:absolute;z-index:-1;inset:0 0 auto;height:2px;background:linear-gradient(90deg,transparent,#69d5ff 24%,#6595ff 70%,transparent);opacity:.9}
    .agent-login-box:after{content:"";position:absolute;z-index:-1;right:-65px;top:-80px;width:190px;height:190px;border:1px solid rgba(91,181,222,.12);border-radius:50%;box-shadow:0 0 0 18px rgba(91,181,222,.025),0 0 0 38px rgba(91,181,222,.02);pointer-events:none}
    .agent-login-kicker{display:flex;align-items:center;gap:8px;margin-bottom:14px;color:#75b9dc;font:10px ui-monospace,Consolas,monospace;letter-spacing:1.2px;text-transform:uppercase}.agent-login-kicker:before{content:"";width:7px;height:7px;border-radius:50%;background:#62d5c4;box-shadow:0 0 10px rgba(98,213,196,.75)}
    .agent-login-box h2{position:relative;margin:0 0 7px;color:#e9f4ff;font-size:21px;font-weight:800;letter-spacing:.2px}.agent-login-box p{max-width:360px;margin:0 0 20px;color:#91a5b8;font-size:12px;line-height:1.7}.agent-login-box input{width:100%;min-height:42px;margin:0 0 10px;padding:10px 12px;border:1px solid #344b61;border-radius:6px;background:rgba(5,12,21,.78);color:#e7f3ff;outline:none;transition:border-color .16s,box-shadow .16s}.agent-login-box input::placeholder{color:#65798d}.agent-login-box input:focus{border-color:#62b9e5;box-shadow:0 0 0 3px rgba(58,157,208,.16)}
    .agent-login-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:4px}.agent-login-submit,.agent-login-guest{min-height:42px;border-radius:6px;font-size:13px;font-weight:750;cursor:pointer;transition:transform .16s,border-color .16s,background .16s}.agent-login-submit{border:1px solid rgba(124,183,255,.52);background:linear-gradient(110deg,#246da9,#4d65c9);color:#fff;box-shadow:0 5px 20px rgba(57,112,211,.24),inset 0 1px rgba(255,255,255,.17)}.agent-login-guest{border:1px solid #38516a;background:rgba(18,31,46,.82);color:#b9ccdc}.agent-login-submit:hover,.agent-login-guest:hover{transform:translateY(-1px)}.agent-login-submit:hover{background:linear-gradient(110deg,#2d83c4,#5c73df)}.agent-login-guest:hover{border-color:#5b86a7;background:#172b3e;color:#e4f4ff}.agent-login-submit:focus-visible,.agent-login-guest:focus-visible{outline:2px solid #78c9ed;outline-offset:2px}
    .agent-login-error{min-height:18px;color:#ff9a84;font-size:12px;margin:0 0 8px}.agent-login-foot{display:flex;align-items:center;gap:7px;margin-top:16px;padding-top:12px;border-top:1px solid rgba(75,101,125,.28);color:#6f8498;font-size:10px;line-height:1.5}.agent-login-foot:before{content:"◇";color:#73bddd;font-size:14px}
    .agent-session-login{display:none;border:1px solid #4e6f9a;border-radius:6px;background:linear-gradient(110deg,rgba(32,74,116,.92),rgba(54,61,126,.92));color:#e8f4ff;padding:7px 13px;font-size:12px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(39,91,160,.2)}.agent-session-login:hover{border-color:#82b9e8;background:linear-gradient(110deg,rgba(43,99,151,.98),rgba(69,77,151,.98))}.agent-session-login:focus-visible{outline:2px solid #78c9ed;outline-offset:2px}
    .agent-session-logout{display:none;border:1px solid #35475d;border-radius:6px;background:#101722;color:#9fb0c2;padding:7px 11px;font-size:12px;cursor:pointer}.agent-session-logout:hover{border-color:#59738f;color:#fff}
    @media(max-width:520px){.agent-login-box{padding:23px 20px}.agent-login-box h2{font-size:19px}.agent-login-actions{grid-template-columns:1fr}.agent-login-box p{margin-bottom:16px}}
  `
  document.head.appendChild(style)
  const mask = document.createElement('div')
  mask.id = 'agentLoginMask'
  mask.className = 'agent-login-mask'
  mask.innerHTML = `<form class="agent-login-box" id="agentLoginForm"><div class="agent-login-kicker">AGENT SECURITY LAB · ACCESS</div><h2>登录攻防实验室</h2><p>登录后可创建战局并查看受保护的数据；密码仅用于向后端换取安全会话。</p><input id="agentLoginPassword" type="password" autocomplete="current-password" placeholder="输入浏览器访问密码" required maxlength="256"><div class="agent-login-error" id="agentLoginError" role="status" aria-live="polite"></div><div class="agent-login-actions"><button type="submit" class="agent-login-submit">登录并继续</button><button type="button" class="agent-login-guest" id="agentGuestBrowse">以游客身份浏览</button></div><div class="agent-login-foot">游客可浏览公开页面；准备和创建战局功能保持禁用。</div></form>`
  document.body.appendChild(mask)
  const loginButton = document.createElement('button')
  loginButton.id = 'agentSessionLogin'
  loginButton.className = 'agent-session-login'
  loginButton.type = 'button'
  loginButton.textContent = '登录'
  loginButton.title = '登录攻防实验室'
  element('healthBtn').insertAdjacentElement('afterend', loginButton)
  loginButton.addEventListener('click', () => showLogin())
  const logout = document.createElement('button')
  logout.id = 'agentSessionLogout'
  logout.className = 'agent-session-logout'
  logout.type = 'button'
  logout.textContent = '退出登录'
  logout.title = '退出当前浏览器会话'
  element('healthBtn').insertAdjacentElement('afterend', logout)
  logout.addEventListener('click', () => void logoutSession())
  element<HTMLFormElement>('agentLoginForm').addEventListener('submit', (event) => {
    event.preventDefault()
    void login()
  })
  element<HTMLButtonElement>('agentGuestBrowse').addEventListener('click', () => {
    state.guestMode = true
    updateSessionControls(state.sessionEnabled, false)
    element<HTMLDivElement>('agentLoginMask').classList.remove('open')
    element<HTMLInputElement>('agentLoginPassword').value = ''
    if (state.sessionEnabled) {
      showToast('游客浏览模式：准备和创建战局功能已禁用')
    } else {
      showToast('已进入浏览模式')
    }
  })
}

function updateSessionControls(enabled: boolean, authenticated: boolean) {
  state.sessionEnabled = enabled
  state.authenticated = authenticated
  if (authenticated) state.guestMode = false
  const loginButton = element<HTMLButtonElement>('agentSessionLogin')
  const logout = element<HTMLButtonElement>('agentSessionLogout')
  loginButton.style.display = enabled && !authenticated ? 'inline-flex' : 'none'
  logout.style.display = enabled && authenticated ? 'inline-flex' : 'none'
  const ready = document.getElementById('btnReady') as HTMLButtonElement | null
  if (ready) {
    ready.disabled = state.guestMode || (enabled && !authenticated)
    ready.title = state.guestMode ? '游客浏览模式下不能创建战局，请登录后继续' : ready.disabled ? '请先登录后再准备战局' : ''
  }
}

function showLogin(message = '') {
  installSessionDialog()
  element<HTMLDivElement>('agentLoginError').textContent = message
  element<HTMLDivElement>('agentLoginMask').classList.add('open')
  element<HTMLInputElement>('agentLoginPassword').focus()
}

async function login() {
  const password = element<HTMLInputElement>('agentLoginPassword')
  const error = element<HTMLDivElement>('agentLoginError')
  error.textContent = ''
  try {
    await json('/auth/session', { method: 'POST', body: JSON.stringify({ password: password.value }) })
    password.value = ''
    element<HTMLDivElement>('agentLoginMask').classList.remove('open')
    state.guestMode = false
    updateSessionControls(true, true)
    showToast('登录成功，正在加载真实战局')
    await Promise.all([loadSummary(), loadHistory(0), checkHealth()])
  } catch (reason) { error.textContent = errorText(reason) }
}

async function logoutSession() {
  const button = element<HTMLButtonElement>('agentSessionLogout')
  button.disabled = true
  try {
    await json('/auth/session', { method: 'DELETE' })
    state.streamAbort?.abort()
    updateSessionControls(true, false)
    showLogin('已安全退出，请重新登录后继续')
  } catch (error) { showToast(`退出失败：${errorText(error)}`) }
  finally { button.disabled = false }
}

async function checkSession() {
  try {
    const session = await json<SessionStatus>('/auth/session')
    updateSessionControls(session.enabled, session.authenticated)
    return !session.enabled || session.authenticated
  } catch { return true }
}

async function checkHealth() {
  const button = element<HTMLButtonElement>('healthBtn')
  button.innerHTML = '<span class="dot"></span>正在检查服务…'
  try {
    const health = await json<{ status: string; storage?: string }>('/health')
    const ok = health.status === 'ok'
    button.innerHTML = `<span class="dot"></span>${ok ? '服务运行正常' : '服务降级'}（${health.storage || health.status}）`
    button.style.color = ok ? '' : '#ffd27a'
  } catch (error) {
    button.innerHTML = '<span class="dot" style="background:#ff6b6b;box-shadow:0 0 8px #ff6b6b"></span>服务连接失败'
    button.style.color = '#ff8f6b'
    button.title = errorText(error)
  }
}

async function loadSummary() {
  try {
    const summary = await json<Summary>('/dashboard/summary')
    element('statBattles').textContent = String(summary.totalBattles ?? 0)
    element('statCases').textContent = String(summary.ruleLibraryCaseCount ?? 0)
    element('statSamples').textContent = String(summary.sampleCount ?? 0)
    element('statCaught').textContent = String(summary.ruleHitCount ?? 0)
    element('statRisks').textContent = String(summary.riskCount ?? 0)
    element('statAgentBattles').textContent = String(summary.acpCallBattles ?? 0)
  } catch (error) { showToast(`统计加载失败：${errorText(error)}`) }
}

async function loadHistory(page = state.page) {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) })
  if (state.query) params.set('q', state.query)
  if (state.difficulty) params.set('difficulty', state.difficulty)
  const list = element<HTMLDivElement>('battleList')
  list.innerHTML = '<div style="padding:28px;text-align:center;color:#68717e">正在加载真实战局…</div>'
  try {
    const response = await request(`/battles?${params}`)
    const battles = await response.json() as Battle[]
    state.page = page
    state.total = Number(response.headers.get('X-Total-Count') || battles.length)
    renderHistory(battles)
    updatePagination()
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) showLogin(error.message)
    list.innerHTML = `<div style="padding:28px;text-align:center;color:#ff8f6b">${escapeHtml(errorText(error))}</div>`
  }
}

function renderHistory(battles: Battle[]) {
  const list = element<HTMLDivElement>('battleList')
  list.innerHTML = ''
  if (!battles.length) {
    list.innerHTML = '<div style="padding:28px;text-align:center;color:#68717e">没有符合条件的真实战局</div>'
    return
  }
  for (const battle of battles) {
    const button = document.createElement('button')
    button.className = 'battle-item'
    button.classList.toggle('active', state.selected?.id === battle.id)
    button.dataset.battleId = battle.id
    const badge = document.createElement('span')
    badge.className = `battle-badge ${battle.difficulty}`
    badge.textContent = difficultyText[battle.difficulty]
    const main = document.createElement('span')
    main.className = 'bi-main'
    const title = document.createElement('b')
    title.textContent = battle.topic
    const meta = document.createElement('small')
    meta.textContent = `${formatTime(battle.createdAt)} · ${statusLabel(battle.status)}`
    main.append(title, meta)
    const id = document.createElement('span')
    id.style.cssText = 'color:#68717e;font-size:12px;margin-right:8px;max-width:150px;overflow:hidden;text-overflow:ellipsis'
    id.textContent = battle.id
    const arrow = document.createElement('span')
    arrow.className = 'arrow'
    arrow.textContent = '›'
    button.append(badge, main, id, arrow)
    button.addEventListener('click', () => void selectBattle(battle.id))
    list.appendChild(button)
  }
}

function statusLabel(status: Battle['status']) {
  return ({ pending: '等待中', running: '进行中', completed: '已完成', failed: '失败' })[status]
}

function updatePagination() {
  const pages = Math.max(1, Math.ceil(state.total / PAGE_SIZE))
  const label = document.querySelector('.pagination span')
  if (label) label.textContent = `第 ${state.page + 1} / ${pages} 页 · 共 ${state.total} 场`
  element<HTMLButtonElement>('prevPage').disabled = state.page <= 0
  element<HTMLButtonElement>('nextPage').disabled = state.page + 1 >= pages
}

async function selectBattle(id: string) {
  try {
    const battle = await json<Battle>(`/battles/${encodeURIComponent(id)}`)
    state.selected = battle
    document.querySelectorAll<HTMLButtonElement>('.battle-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.battleId === battle.id)
    })
    renderBattleDetail(battle)
  } catch (error) { showToast(`详情加载失败：${errorText(error)}`) }
}

function renderBattleDetail(battle: Battle) {
  publishBattleVisualizations([], 'loading')
  element('detailTopic').textContent = `${battle.topic}  ${battle.id}`
  element('detailMeta').textContent = `${difficultyText[battle.difficulty]}难度 · ${statusLabel(battle.status)} · ${formatTime(battle.createdAt)}`
  const samples = battle.attackerOut?.samples || []
  const defenses = battle.defenderOut || []
  const rounds = document.querySelector('.rounds-scroll') as HTMLDivElement
  rounds.innerHTML = '<div class="panel-title" style="margin-top:8px">逐轮对抗 <small>ROUNDS</small><span class="en"></span></div>'
  const count = rounds.querySelector('.en')
  const totalRounds = Number(battle.rounds) || samples.length || 3
  if (count) count.textContent = `${samples.length}/${totalRounds} rounds`
  samples.forEach((sample, index) => rounds.appendChild(roundCard(sample, defenses[index], index + 1, battle)))
  if (!samples.length) {
    const empty = document.createElement('div')
    empty.style.cssText = 'padding:40px;text-align:center;color:#68717e'
    empty.textContent = battle.status === 'failed' ? '本场战局失败，未生成攻击样本' : '正在等待后端生成攻击样本'
    rounds.appendChild(empty)
  }
  const caught = defenses.reduce((sum, item) => sum + (item.caught?.length || 0), 0)
  const fixed = defenses.reduce((sum, item) => sum + (item.fixed?.length || 0), 0)
  element('stageCreated').textContent = '1'
  element('stageAttacks').textContent = String(samples.length)
  element('stageChecks').textContent = String(caught)
  element('stageFixes').textContent = String(fixed)
  configureActions(battle)
  void refreshBattleVisualizations(battle.id)
}

function scoreValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const summary = record.summary && typeof record.summary === 'object' ? record.summary as Record<string, unknown> : undefined
  return scoreValue(record.finalScore ?? record.score ?? summary?.finalScore)
}

function scorePart(role: RoundScoreRole | undefined, key: 'processScore' | 'effectScore' | 'responseScore' | 'baseScore' | 'finalScore') {
  const summary = role?.summary
  const value = summary?.[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const group = key === 'processScore' ? 'process' : key === 'effectScore' ? 'effect' : key === 'responseScore' ? 'response' : null
  const categories = Array.isArray(role?.categories) ? role.categories : []
  if (!group || !categories.some((category) => category.group === group)) return null
  return categories
    .filter((category) => category.group === group)
    .reduce((sum, category) => sum + scoreNumber(category.score), 0)
}

function eventRoundScore(event: BattleEvent): LiveRoundScore | null {
  const data = event.data
  const totals = data.scores && typeof data.scores === 'object' ? data.scores as Record<string, unknown> : {}
  // arbiter.round.scored 同时返回完整角色评分对象和 scores 中的综合分数字。
  // 实时评分需要优先保留完整对象，才能展示流程、效果、响应和逐项证据。
  const attackerRole = data.attacker && typeof data.attacker === 'object' ? data.attacker as RoundScoreRole : undefined
  const defenderRole = data.defender && typeof data.defender === 'object' ? data.defender as RoundScoreRole : undefined
  const attacker = scoreValue(attackerRole) ?? scoreValue(totals.attacker)
  const defender = scoreValue(defenderRole) ?? scoreValue(totals.defender)
  return attacker === null && defender === null ? null : { attacker, defender, attackerRole, defenderRole }
}

function renderLiveRoundScores() {
  const list = document.getElementById('liveRoundScoreList')
  if (!list) return
  const entries = [...liveRoundScores.entries()].sort(([left], [right]) => left - right)
  list.replaceChildren()
  if (!entries.length) {
    const empty = document.createElement('div')
    empty.className = 'live-round-score-empty'
    empty.textContent = '等待回合结算'
    list.appendChild(empty)
    return
  }
  entries.forEach(([round, scores]) => {
    const row = document.createElement('div')
    row.className = 'live-round-score-row'
    const roundLabel = document.createElement('span')
    roundLabel.className = 'round-number'
    roundLabel.textContent = `R${round}`
    const attacker = document.createElement('span')
    attacker.className = 'round-att'
    attacker.innerHTML = '<span>Attacker</span>'
    const attackerScore = document.createElement('b')
    attackerScore.textContent = scores.attacker === null ? '—' : scores.attacker.toFixed(2)
    attacker.appendChild(attackerScore)
    const defender = document.createElement('span')
    defender.className = 'round-def'
    defender.innerHTML = '<span>Defender</span>'
    const defenderScore = document.createElement('b')
    defenderScore.textContent = scores.defender === null ? '—' : scores.defender.toFixed(2)
    defender.appendChild(defenderScore)
    row.append(roundLabel, attacker, defender)
    list.appendChild(row)
  })
}

function syncLiveRoundScore(round: number, scores: LiveRoundScore) {
  if (!round) return
  liveRoundScores.set(round, scores)
  renderLiveRoundScores()
  const latest = scores
  if (latest.attacker !== null) element('atkWeighted').textContent = latest.attacker.toFixed(2)
  if (latest.defender !== null) element('defWeighted').textContent = latest.defender.toFixed(2)
  syncLiveScoreParts(scores.attackerRole, scores.defenderRole)
  element('scoreScopeTitle').textContent = '实时评分 · 当前回合'
  element('scoreScopeNote').textContent = `当前展示第 ${round} 回合已结算的评分`
  element('scoreStatus').textContent = `第 ${round} 回合已结算`
  const rounds = [...liveRoundScores.entries()]
    .sort(([left], [right]) => left - right)
    .map(([number, item]) => ({
      round: number,
      attacker: item.attackerRole,
      defender: item.defenderRole,
      scores: { attacker: item.attacker, defender: item.defender },
    }))
  window.dispatchEvent(new CustomEvent('battle-scores:update', {
    detail: {
      rounds,
      latest: rounds.at(-1),
      label: `第 ${round} 回合已结算`,
    },
  }))
}

function syncLiveScoreParts(attacker: RoundScoreRole | undefined, defender: RoundScoreRole | undefined) {
  const values: Array<[string, number | null]> = [
    ['atkProcess', scorePart(attacker, 'processScore')],
    ['atkEffect', scorePart(attacker, 'effectScore')],
    ['atkResponse', scorePart(attacker, 'responseScore')],
    ['defProcess', scorePart(defender, 'processScore')],
    ['defEffect', scorePart(defender, 'effectScore')],
    ['defResponse', scorePart(defender, 'responseScore')],
  ]
  values.forEach(([id, value]) => {
    element(id).textContent = value === null ? '证据不足' : String(value)
  })
}

function publishBattleVisualizations(rounds: readonly BattleVisualizationRound[], status: 'loading' | 'ready' | 'unavailable') {
  window.dispatchEvent(new CustomEvent('battle-visualizations:update', {
    detail: { ...buildBattleVisualizations(rounds), status },
  }))
}

async function refreshBattleVisualizations(battleId: string) {
  const requestGeneration = ++visualizationRequestGeneration
  try {
    const encodedBattleId = encodeURIComponent(battleId)
    const [result, similarityEvents] = await Promise.all([
      json<{ rounds?: (BattleVisualizationRound & BattleRoundScore)[] }>(`/battles/${encodedBattleId}/rounds`),
      json<BattleEvent[]>(`/battles/${encodedBattleId}/events?event_type=arbiter.similarity.checked&limit=1000`).catch(() => []),
    ])
    if (state.selected?.id !== battleId || requestGeneration !== visualizationRequestGeneration) return
    renderRoundScoreDetails(result.rounds || [])
    const sourceByRound = new Map<number, string>()
    similarityEvents.forEach((event) => {
      const round = Number(event.data.round)
      const sourceType = event.data.sourceType
      if (Number.isInteger(round) && round > 0 && typeof sourceType === 'string') sourceByRound.set(round, sourceType)
    })
    const visualizationRounds = (result.rounds || []).map((round) => ({
      ...round,
      sourceType: sourceByRound.get(Number(round.round)) ?? round.sourceType,
    }))
    liveRoundScores.clear()
    ;(result.rounds || []).forEach((round) => {
      const attackerRole = round.attacker && typeof round.attacker === 'object' ? round.attacker : undefined
      const defenderRole = round.defender && typeof round.defender === 'object' ? round.defender : undefined
      const attacker = scoreValue(round.attacker)
      const defender = scoreValue(round.defender)
      if (attacker !== null || defender !== null) liveRoundScores.set(Number(round.round), { attacker, defender, attackerRole, defenderRole })
    })
    renderLiveRoundScores()
    const latest = (result.rounds || []).filter((round) => scoreValue(round.attacker) !== null || scoreValue(round.defender) !== null).at(-1)
    if (latest) {
      const attackerRole = latest.attacker && typeof latest.attacker === 'object' ? latest.attacker : undefined
      const defenderRole = latest.defender && typeof latest.defender === 'object' ? latest.defender : undefined
      const normalizedLatest = {
        ...latest,
        attacker: attackerRole,
        defender: defenderRole,
      }
      syncLiveScoreParts(
        attackerRole,
        defenderRole,
      )
      window.dispatchEvent(new CustomEvent('battle-scores:update', {
        detail: { rounds: result.rounds || [], latest: normalizedLatest, label: `第 ${latest.round} 回合已结算` },
      }))
    }
    publishBattleVisualizations(visualizationRounds, 'ready')
  } catch {
    if (state.selected?.id !== battleId || requestGeneration !== visualizationRequestGeneration) return
    publishBattleVisualizations([], 'unavailable')
  }
}

function roundCard(sample: Sample, defense: Defense | undefined, round: number, battle: Battle) {
  const card = document.createElement('div')
  card.className = 'round-card'
  card.dataset.round = String(round)
  card.innerHTML = `<div class="round-head"><b>第 ${round} 轮（Round ${round}）</b><span class="pill"></span><span class="state">${battle.status === 'completed' ? '已完成' : '处理中'}</span></div><div class="round-body"><div class="side atk"><h4>攻击方 · 样本生成</h4><div class="round-tags"></div><div class="sample"><span class="sample-label">原始样本</span><span class="sample-copy"></span></div></div><div class="side def"><h4>防守方 · 检测与修复</h4><div class="def-tags"></div><div class="def-findings"></div></div></div>`
  const pill = card.querySelector('.pill')!
  pill.textContent = `${sample.type || 'sample'} · ${sample.severity || battle.difficulty}`
  const tags = card.querySelector('.round-tags')!
  tags.append(chip(`来源：${sourceLabel(battle.attackerOut?.agentSource)}`), chip(`用例：${sample.testCaseId || '未记录'}`))
  const copy = card.querySelector('.sample-copy')!
  copy.textContent = sample.content || '后端未返回样本文本'
  const defTags = card.querySelector('.def-tags')!
  defTags.append(chip(`来源：${sourceLabel(defense?.agentSource)}`), chip(defense?.verificationStatus || '目标未验证'))
  const findings = card.querySelector('.def-findings')!
  findings.append(finding('规则命中', defense?.caught, 'reason', '未命中当前规则'))
  findings.append(finding('风险评估', defense?.risks, 'reason', '无额外风险记录'))
  findings.append(finding('修复建议', defense?.fixed, 'action', '暂无建议'))
  if (defense?.scopeNotice) findings.append(findingText('验证范围', defense.scopeNotice))
  return card
}

function scoreNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function scoreText(value: unknown, max: unknown) {
  const score = typeof value === 'number' && Number.isFinite(value) ? value : null
  const limit = scoreNumber(max)
  return score === null ? '证据不足' : `${score} / ${limit}`
}

function scoreRow(label: string, value: unknown, max: unknown, className = '') {
  const row = document.createElement('div')
  row.className = `score-row${className ? ` ${className}` : ''}`
  const name = document.createElement('span')
  name.textContent = label
  const result = document.createElement('b')
  result.textContent = scoreText(value, max)
  row.append(name, result)
  return row
}

function scoreCategories(role: RoundScoreRole | undefined) {
  const panel = document.createElement('div')
  panel.className = 'score-detail-panel'
  const categories = Array.isArray(role?.categories) ? role.categories : []
  const groups: Array<[string, string]> = [['process', '流程规范 / 40'], ['effect', '实际效果 / 60'], ['response', '响应 / 100（计入综合分 5%）']]
  for (const [group, title] of groups) {
    const items = categories.filter((category) => category.group === group)
    if (!items.length) continue
    const heading = document.createElement('div')
    heading.className = 'score-subhead'
    heading.textContent = title
    panel.appendChild(heading)
    for (const category of items) {
      panel.appendChild(scoreRow(`${category.id ? `${category.id} · ` : ''}${category.label || '未命名分项'}`, category.score, category.maxScore))
    }
  }
  return panel
}

function renderRoundScoreDetails(rounds: readonly BattleRoundScore[]) {
  const cards = document.querySelectorAll<HTMLElement>('.round-card[data-round]')
  cards.forEach((card) => {
    if (card.querySelector('.score-details')) return
    const round = Number(card.dataset.round)
    const scored = rounds.find((item) => item.round === round)
    if (!scored?.attacker && !scored?.defender) return
    const attacker = scored.attacker
    const defender = scored.defender
    const attackerSummary = attacker?.summary || {}
    const defenderSummary = defender?.summary || {}
    const details = document.createElement('details')
    details.className = 'score-details'
    const summary = document.createElement('summary')
    summary.textContent = '评分细则（流程 40 + 效果 60 = 基础分；响应 0–100 按 5% 计入综合分）'
    details.appendChild(summary)
    const columns = document.createElement('div')
    columns.className = 'score-cols'
    const roleColumn = (title: string, role: RoundScoreRole | undefined, values: NonNullable<RoundScoreRole['summary']>, tone: string) => {
      const column = document.createElement('div')
      column.className = `score-col ${tone}`
      const heading = document.createElement('h5')
      heading.textContent = title
      column.appendChild(heading)
      column.appendChild(scoreRow('流程规范', values.processScore, 40))
      column.appendChild(scoreRow(tone === 'def' ? '实际防御效果' : '分层穿透效果', values.effectScore, 60))
      column.appendChild(scoreRow('基础攻防分（流程+效果）', values.baseScore, 100, 'total'))
      column.appendChild(scoreRow('响应分（0–100，计入综合分 5%）', values.responseScore, 100))
      column.appendChild(scoreRow('总分', values.finalScore ?? role?.score, 100, 'weighted'))
      const toggleLabel = document.createElement('label')
      toggleLabel.className = 'score-detail-check compact'
      const toggle = document.createElement('input')
      toggle.type = 'checkbox'
      const toggleText = document.createElement('span')
      toggleText.textContent = '各环节的详细评分（勾选后显示并导入导出文件）'
      const detail = scoreCategories(role)
      detail.hidden = true
      toggle.addEventListener('change', () => { detail.hidden = !toggle.checked })
      toggleLabel.append(toggle, toggleText)
      column.append(toggleLabel, detail)
      return column
    }
    columns.append(
      roleColumn('Attacker 攻击方', attacker, attackerSummary, 'atk'),
      roleColumn('Defender 防守方', defender, defenderSummary, 'def'),
    )
    details.appendChild(columns)
    card.appendChild(details)
  })
}

function chip(value: string) {
  const span = document.createElement('span')
  span.className = 'code-chip'
  span.textContent = value
  return span
}

function finding(label: string, values: DefenseItem[] | undefined, key: 'reason' | 'action', fallback: string) {
  return findingText(label, values?.map((item) => item[key]).filter(Boolean).join('；') || fallback)
}

function findingText(label: string, value: string) {
  const row = document.createElement('div')
  row.className = 'finding'
  const name = document.createElement('span')
  name.className = 'k'
  name.textContent = label
  const content = document.createElement('span')
  content.className = 'v'
  content.textContent = value
  row.append(name, content)
  return row
}

function configureActions(battle: Battle) {
  const deleteButton = element<HTMLButtonElement>('deleteBtn')
  deleteButton.disabled = true
  deleteButton.textContent = '后端暂不支持删除'
  deleteButton.title = '后端尚未提供 DELETE /battles/{id}'
  let retry = document.getElementById('retryBattleBtn') as HTMLButtonElement | null
  if (battle.status === 'failed') {
    if (!retry) {
      retry = document.createElement('button')
      retry.id = 'retryBattleBtn'
      retry.className = 'btn-ghost'
      element('exportBtn').parentElement?.prepend(retry)
    }
    retry.textContent = '重试战局'
    retry.hidden = false
    retry.onclick = () => void retryBattle(battle.id)
  } else if (retry) retry.hidden = true
}

async function retryBattle(id: string) {
  try {
    const battle = await json<Battle>(`/battles/${encodeURIComponent(id)}/retry`, { method: 'POST' })
    showToast('失败战局已重新提交')
    beginLiveBattle(battle)
    await followEvents(battle.id)
  } catch (error) { showToast(`重试失败：${errorText(error)}`) }
}

function selectedDifficulty(): Difficulty | null {
  const card = document.querySelector('.diff-card.selected')
  if (!card) return null
  if (card.classList.contains('low')) return 'low'
  if (card.classList.contains('high')) return 'high'
  return 'mid'
}

async function startBattle() {
  if (state.guestMode) {
    showToast('游客模式仅可浏览，请登录后创建战局')
    return
  }
  if (state.sessionEnabled && !state.authenticated) {
    showLogin('创建战局需要先登录')
    return
  }
  if (state.starting) return
  const topic = element<HTMLInputElement>('themeInput').value.trim()
  const difficulty = selectedDifficulty()
  const requestedRounds = Number.parseInt(element<HTMLInputElement>('roundInput').value, 10)
  const rounds = Number.isFinite(requestedRounds) ? Math.min(10, Math.max(3, requestedRounds)) : 3
  if (!topic || !difficulty) {
    showToast('请先填写主题并选择难度')
    return
  }
  const start = element<HTMLButtonElement>('btnStart')
  state.requestedRounds = rounds
  state.starting = true
  start.disabled = true
  start.textContent = '正在创建…'
  try {
    const battle = await json<Battle>('/battles?background=true', {
      method: 'POST', body: JSON.stringify({ topic, difficulty, rounds }),
    })
    element('cfgMask').classList.remove('open')
    beginLiveBattle(battle)
    showToast(`真实战局 ${battle.id} 已创建；共 ${rounds} 回合`)
    await followEvents(battle.id)
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) showLogin(error.message)
    showToast(`创建失败：${errorText(error)}`, 5000)
  } finally {
    state.starting = false
    start.disabled = false
    start.textContent = '开始攻防'
  }
}

function beginLiveBattle(battle: Battle) {
  state.streamSeen.clear()
  timelinePlaybackQueue = []
  threePlaybackQueue = []
  pendingAnimationResolvers.forEach((resolve) => resolve())
  state.selected = battle
  liveTimelineProjector = new LiveBattleTimelineProjector()
  liveLifecycleProjector = new LiveBattleLifecycleProjector()
  liveRoundScores.clear()
  renderLiveRoundScores()
  publishBattleVisualizations([], 'loading')
  const roundLimit = Number(battle.rounds) || state.requestedRounds || 3
  element('liveId').textContent = battle.id
  element('liveLevel').textContent = `${difficultyText[battle.difficulty]}（${battle.difficulty}）`
  element('liveTheme').textContent = `对抗主题：${battle.topic}`
  element('liveRounds').textContent = `0/${roundLimit}`
  element('stageId').textContent = battle.id
  element('stageLevel').textContent = difficultyText[battle.difficulty]
  element('stageTheme').textContent = battle.topic
  element('stageRounds').textContent = String(roundLimit)
  element('detailTopic').textContent = `实时战局 · ${battle.topic}`
  element('detailMeta').textContent = `${battle.id} · ${difficultyText[battle.difficulty]} · 进行中`
  element('tlContent').innerHTML = '<div class="axis"></div>'
  element('payloadBody').innerHTML = '<div class="payload-empty">回合 payload 实时输出区</div>'
  element('tlSub').textContent = `主题：${battle.topic} · 难度：${difficultyText[battle.difficulty]} · LIVE 后端事件`
  const status = element('liveStatus')
  status.textContent = '正在连接真实事件流'
  status.classList.add('run')
  const empty = document.getElementById('tlEmpty')
  if (empty) empty.style.display = 'none'
  window.dispatchEvent(new CustomEvent('battle-timeline:reset'))
  window.BattleEventBus?.reset(battle.id)
  window.BattleEventBus?.setMode('live')
  window.BattleEventBus?.emit({ type: 'battle_started', battleId: battle.id, source: 'live', mock: false, payload: { theme: battle.topic, difficulty: battle.difficulty, roundLimit } })
}

async function followEvents(battleId: string) {
  state.streamAbort?.abort()
  const abort = new AbortController()
  state.streamAbort = abort
  let reconnects = 0
  let terminal = false
  let malformed = 0

  while (!abort.signal.aborted && !terminal && reconnects < 6) {
    let receivedNewEvent = false
    try {
      const response = await request(`/battles/${encodeURIComponent(battleId)}/events/stream?follow=true`, { signal: abort.signal })
      if (!response.body) throw new Error('浏览器不支持实时事件流')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (!terminal) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '')
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() || ''
        for (const block of blocks) {
          const event = parseSseData<BattleEvent>(block)
          if (!event) {
            malformed += 1
            continue
          }
          if (state.streamSeen.has(event.id)) continue
          state.streamSeen.add(event.id)
          receivedNewEvent = true
          renderLiveEvent(event)
          if (event.type === 'battle.completed' || event.type === 'battle.failed') {
            terminal = true
            await finishLiveBattle(event)
            break
          }
        }
      }
    } catch (error) {
      if (abort.signal.aborted) return
      if (error instanceof ApiError && error.status === 401) {
        showLogin(error.message)
        return
      }
      element('liveStatus').textContent = '实时连接中断，正在自动重连'
    }

    if (terminal || abort.signal.aborted) break
    reconnects = receivedNewEvent ? 0 : reconnects + 1
    element('liveStatus').textContent = `事件流已结束，正在重新连接（${reconnects + 1}/6）`
    await waitForReconnect(reconnectDelay(reconnects), abort.signal)
  }

  if (malformed) showToast(`已忽略 ${malformed} 条格式异常的实时事件`)
  if (!terminal && !abort.signal.aborted) {
    element('liveStatus').textContent = '实时连接暂时中断，可从历史记录恢复'
    showToast('事件流多次重连失败，请从历史记录查看最终结果')
  }
}

function waitForReconnect(delay: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, delay)
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}

function renderLiveEvent(event: BattleEvent) {
  const round = Number(event.data.round || 0)
  // 3D 事件先进入串行播放队列；时间线视觉项共享同一个完成信号。
  const ready = bridge3dEvent(event, round)
  if (event.type === 'arbiter.round.score' || event.type === 'arbiter.round.scored' || event.type === 'round.settled') {
    const scores = eventRoundScore(event)
    if (scores) {
      if (slowPlayback) enqueueTimelinePlayback(() => syncLiveRoundScore(round, scores), ready)
      else syncLiveRoundScore(round, scores)
    }
  }
  if (event.type === 'attack.sample.generated') {
    if (slowPlayback) enqueueTimelinePlayback(() => appendLivePayload(event, round), ready)
    else appendLivePayload(event, round)
  }
  const entries = liveTimelineProjector.push(event)
  if (event.type.startsWith('agent.call.')) {
    const role = event.data.agentRole === 'defender' ? '防守方' : '攻击方'
    const state = event.type.endsWith('.started') ? '处理中' : event.type.endsWith('.failed') ? '调用失败' : '已完成'
    element('liveStatus').textContent = `${role}智能体${state}`
  }
  for (const entry of entries) {
    const total = Number(state.selected?.rounds) || state.requestedRounds || 0
    if (entry.kind === 'round') {
      const publishRound = () => {
        ensureRound(entry.round)
        element('liveRounds').textContent = `${entry.round}/${Number(state.selected?.rounds) || state.requestedRounds || '—'}`
      }
      window.dispatchEvent(new CustomEvent('battle-timeline:round', {
        detail: { round: entry.round, total },
      }))
      if (slowPlayback) enqueueTimelinePlayback(publishRound, ready)
      else publishRound()
      continue
    }
    const entryRound = Number(entry.event.data.round || round)
    const timing = eventTiming(entry.event)
    const evidenceIds = timelineEvidenceIds(entry.event)
    // 「Ln 已穿透」是合成卡：不属于任何单条后端事件，文案由层级推导。
    const penetratedLayer = entry.variant === 'penetrated' ? Number(entry.event.data.layerIndex) : NaN
    const title = entry.variant === 'penetrated'
      ? `L${penetratedLayer} 已穿透`
      : eventTitle(entry.event)
    const description = entry.variant === 'penetrated'
      ? (penetratedLayer >= 3
        ? 'payload 融入 Core · L3 球壳破裂 · Core 由蓝色变为红色。'
        : `payload 来到下一层 L${penetratedLayer + 1}；本层全部环节通过且事件卡已出完，防御球层破裂。`)
      : eventDescription(entry.event)
    const publishEntry = () => {
      appendTimeline(entry.side, entry.key, entry.event, title, description, timing, evidenceIds)
      element('liveStatus').textContent = title
    }
    // 角色日志保持实时：它不等待慢速播放，也不改变后端时间戳。
    window.dispatchEvent(new CustomEvent('battle-timeline:entry', {
      detail: {
        round: entryRound,
        total,
        side: entry.side,
        title,
        description,
        stageId: entry.event.data.stageId || entry.event.type,
        evidenceIds,
        status: entry.event.status || entry.event.data.status || '',
        resultText: description,
        timeText: formatTime(entry.event.createdAt),
        responseMs: timing.responseMs,
      },
    }))
    if (slowPlayback) enqueueTimelinePlayback(publishEntry, ready)
    else publishEntry()
  }
  if (event.type === 'round.completed') {
    const refresh = () => { void refreshBattleVisualizations(event.battleId) }
    if (slowPlayback) enqueueTimelinePlayback(refresh, ready)
    else refresh()
  }
}

function appendLivePayload(event: BattleEvent, round: number) {
  const body = element<HTMLDivElement>('payloadBody')
  body.querySelector('.payload-empty')?.remove()
  const sample = event.data.sample && typeof event.data.sample === 'object'
    ? event.data.sample as Sample
    : {}
  const item = document.createElement('div')
  item.className = 'live-payload-item'
  item.style.cssText = 'margin-bottom:10px;padding:8px 10px;border-left:3px solid #ff8f6b;background:#1a2230;border-radius:4px;font-size:12px;color:#c8d0dc;line-height:1.6;overflow-wrap:anywhere;word-break:break-word;min-width:0'
  const heading = document.createElement('div')
  heading.style.cssText = 'color:#ff8f6b;font-weight:600;margin-bottom:4px'
  heading.textContent = `R${round} · Attacker Payload`
  const content = document.createElement('div')
  content.textContent = sample.content || '后端未返回样本文本'
  item.append(heading, content)
  body.appendChild(item)
  body.scrollTop = body.scrollHeight
}

function ensureRound(round: number) {
  if (!round || document.querySelector(`.round[data-live-round="${round}"]`)) return
  const marker = document.createElement('div')
  marker.className = 'round'
  marker.dataset.liveRound = String(round)
  marker.textContent = `回合 ${round}`
  element('tlContent').appendChild(marker)
}

function eventTiming(event: BattleEvent) {
  const timing = event.data.timing
  const nested = timing && typeof timing === 'object' ? timing as Record<string, unknown> : {}
  const read = (key: string) => event.data[key] ?? nested[key] ?? ''
  return {
    startedAt: String(read('startedAt') || read('startTime') || event.createdAt),
    endedAt: String(read('endedAt') || read('endTime') || event.createdAt),
    responseMs: Number(read('responseMs') || read('durationMs') || 0),
  }
}

function timelineEvidenceIds(event: BattleEvent): unknown[] {
  const direct = Array.isArray(event.data.evidenceIds) ? event.data.evidenceIds : []
  const nested = Array.isArray(event.data.evidence) ? event.data.evidence : []
  const refs = Array.isArray(event.data.evidenceRefs) ? event.data.evidenceRefs : []
  return [...new Set([...direct, ...nested, ...refs].map((value) => {
    if (typeof value === 'string' || typeof value === 'number') return String(value)
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      return String(record.id ?? record.evidenceId ?? record.ref ?? '')
    }
    return ''
  }).filter(Boolean))]
}

function timelineStatus(event: BattleEvent) {
  const type = event.type
  const classification = typeof event.data.classification === 'string'
    ? event.data.classification.trim().toLowerCase()
    : ''
  const explicit = typeof event.data.status === 'string'
    ? event.data.status.trim().toLowerCase()
    : ''
  const status = String(event.status || '').trim().toLowerCase()
  if (type.endsWith('.started')) return 'running'
  if (classification && classification !== 'completed') return classification
  if (explicit && explicit !== 'completed') return explicit
  if (type === 'attack.stage.completed' && classification === 'passed') return 'passed'
  return status || classification || explicit || 'pending'
}

function timelineStatusLabel(status: string) {
  return ({
    running: '进行中', pending: '等待中', completed: '已完成', passed: '已通过', confirmed: '已确认',
    blocked: '已阻断', contained: '已控制', 'full-penetration': '完全穿透', unresolved: '证据不足',
    'system-void': '系统无效', 'not-applicable': '不适用', 'skipped-by-block': '阻断后跳过', failed: '执行失败',
    baseline: '基线样本', 'same-source': '同源样本', 'new-source': '新源样本',
  } as Record<string, string>)[status] || status || '等待中'
}

type TimelineGuide = { input: string; action: string; next: string; score: string }

const attackTimelineGuide: Record<string, Omit<TimelineGuide, 'score'>> = {
  A1: { input: '战局编号、规则版本、总回合数、难度和授权范围', action: '读取并核对已锁定的战局配置', next: 'A2 · 选择唯一样本与攻击面' },
  A2: { input: '授权样本库、攻击面和目标层', action: '选择唯一 sampleId，并确认目标层', next: 'A3 · 选择攻击意图与策略' },
  A3: { input: '当前样本与上一回合公开裁决', action: '确定模拟攻击意图、策略及变化点', next: 'A4 · 构建合成 Payload' },
  A4: { input: '已选样本、策略和授权靶场范围', action: '构建仅用于授权靶场的合成 Payload', next: 'A5 · 授权与格式自检' },
  A5: { input: 'Payload、授权范围和格式约束', action: '检查真实凭据、真实目标、长度、编码和格式', next: 'A6 · 相似度元数据校验' },
  A6: { input: '当前 Payload 与全部合格历史样本', action: '由 Arbiter 计算相似度并判定 baseline / same-source / new-source', next: 'A7 · 冻结并正式提交' },
  A7: { input: '已通过自检和来源校验的 Payload', action: '冻结 Payload，生成提交标识并正式提交', next: 'L0 · 输入层检查' },
  A8: { input: 'Arbiter 已公开的最终裁决', action: '仅基于公开信息复盘并形成下一回合策略', next: '安全对照测试与回合结算' },
}

function timelineGuide(event: BattleEvent, description: string): TimelineGuide {
  const data = event.data
  const stageId = String(data.stageId || '').trim().toUpperCase()
  const status = timelineStatus(event)
  if (event.type === 'agent.call.started' || event.type === 'agent.call.completed' || event.type === 'agent.call.failed') {
    const role = String(data.agentRole || '').toLowerCase() === 'defender' ? 'Defender' : 'Attacker'
    const phase = event.type.endsWith('.started') ? '发起后端智能体调用'
      : event.type.endsWith('.failed') ? '记录后端智能体调用失败'
      : '接收后端智能体调用结果'
    return {
      input: `${role} · ${text(data.stageId || '当前阶段')} · correlationId ${text(data.correlationId)}`,
      action: phase,
      next: event.type.endsWith('.failed') ? '暂停当前分支，等待重试或 Arbiter 标记 system-void' : role === 'Attacker' ? '继续对应 A 阶段事件' : '继续 L0 → L1 → L2 → L3 防御检查',
      score: `响应耗时 ${text(data.durationMs)} ms 进入本回合响应证据；调用失败不得用速度补分`,
    }
  }
  const attack = attackTimelineGuide[stageId]
  const unresolved = status === 'unresolved' || status === 'system-void' || status === 'failed'
  const blocked = status === 'blocked'
  if (attack) {
    return {
      ...attack,
      next: unresolved ? '暂停当前阶段，等待补充证据或重试' : attack.next,
      score: unresolved ? '不可用响应速度补分；等待 Arbiter 有效结论' : '由本回合 Arbiter 评分事件统一计入',
    }
  }
  if (/^L[0-3]-\d+$/.test(stageId)) {
    return {
      input: String(data.evidenceBasis || 'Payload、当前防御层规则与已有证据'),
      action: String(data.checkDescription || data.checkName || '执行当前检查点并记录证据'),
      next: blocked ? '停止后续检查，进入 Arbiter 最终裁决' : unresolved ? '暂停时间线，等待补充证据' : '当前层下一检查点或 Arbiter 层确认',
      score: unresolved ? '证据不足，本项不得通过响应速度补分' : '检查结果进入 Defender 流程分与实际效果分证据链',
    }
  }
  if (event.type === 'arbiter.layer.started' || event.type === 'arbiter.layer.confirmed') {
    return {
      input: `${stageId || '当前层'}检查点状态与证据`,
      action: event.type === 'arbiter.layer.started' ? '开启本层裁决窗口' : '确认必要检查均已通过且证据完整',
      next: unresolved ? '暂停时间线，等待证据补充' : '进入下一防御层或最终分类',
      score: '只有 Arbiter 确认后的层穿透事实才进入评分',
    }
  }
  if (event.type === 'arbiter.verdict') {
    return { input: '各层检查、实际效果与恢复证据', action: '生成唯一最终分类', next: 'A8 · 公开结果复盘', score: '锁定本回合实际效果分类' }
  }
  if (
    event.type === 'arbiter.safe_control'
    || event.type === 'arbiter.safe_control.started'
    || event.type === 'arbiter.safe_control.verdict'
    || event.type === 'defense.safe_control'
  ) {
    return { input: '独立正常样本与安全对照证据', action: '验证正常样本是否被正确放行', next: '回合评分与结算', score: '影响 Defender D-07 及相应响应分' }
  }
  if (event.type === 'arbiter.round.score' || event.type === 'arbiter.round.scored') {
    return { input: '完整事件链、裁决和响应时长', action: '计算双方基础分、响应分与综合分', next: '本回合结算', score: '写入当前回合实时评分' }
  }
  if (event.type === 'round.settled') {
    return { input: '最终分类、安全对照和回合评分', action: '冻结回合结果并更新有效回合计数', next: '下一有效回合或整局结算', score: '有效回合计入整局平均分；system-void 不计入' }
  }
  if (event.type === 'battle.completed' || event.type === 'battle.failed') {
    return { input: '全部有效回合与无效回合记录', action: '完成整局结算并保留事件链', next: '历史战局与复盘', score: '按有效回合综合分平均值生成整局结果' }
  }
  return { input: '后端实时事件数据', action: description, next: '等待下一条有效事件', score: '由 Arbiter 统一确认评分影响' }
}

function timelineDetail(label: string, value: string) {
  const item = document.createElement('span')
  const title = document.createElement('b')
  title.textContent = label
  item.append(title, document.createTextNode(` ${value || '—'}`))
  return item
}

function appendTimeline(
  side: 'att' | 'def' | 'judge',
  key: string,
  sourceEvent: BattleEvent,
  title: string,
  description: string,
  timing?: { startedAt: string; endedAt: string; responseMs: number },
  evidenceIds: unknown[] = [],
) {
  const host = element('tlContent')
  let event = Array.from(host.querySelectorAll<HTMLElement>('.event'))
    .find((item) => item.dataset.timelineKey === key)
  const isNew = !event
  const expanded = event?.querySelector<HTMLDetailsElement>('.event-disclosure')?.open || false
  if (!event) event = document.createElement('div')
  event.className = `event ${side}${expanded ? ' is-expanded' : ''}`
  event.dataset.timelineKey = key
  event.dataset.eventId = sourceEvent.id
  
  event.replaceChildren()
  const card = document.createElement('div')
  card.className = 'card'
  const actor = document.createElement('div')
  actor.className = 'actor'
  actor.textContent = side === 'att' ? 'ATTACKER' : side === 'def' ? 'DEFENDER' : 'ARBITER'
  const name = document.createElement('div')
  name.className = 'name'
  name.textContent = title
  const desc = document.createElement('div')
  desc.className = 'desc'
  desc.textContent = description
  const statusValue = timelineStatus(sourceEvent)
  const status = document.createElement('span')
  status.className = `event-status ${statusValue}`
  status.textContent = timelineStatusLabel(statusValue)
  const timingRow = document.createElement('div')
  timingRow.className = 'timing'
  const start = timing?.startedAt ? formatTime(timing.startedAt) : ''
  const end = timing?.endedAt ? formatTime(timing.endedAt) : ''
  const response = Number.isFinite(timing?.responseMs) && (timing?.responseMs ?? 0) >= 0
    ? `响应 ${(timing!.responseMs / 1000).toFixed(2)}s`
    : ''
  ;[`开始 ${start || formatTime(sourceEvent.createdAt)}`, `结束 ${end || '—'}`, response || '响应 —'].forEach((value) => {
    const item = document.createElement('span')
    item.textContent = value
    timingRow.appendChild(item)
  })
  const audit = document.createElement('div')
  audit.className = 'event-audit'
  const auditValues = [
    ['回合', String(sourceEvent.data.round || '—')],
    ['角色', String(sourceEvent.data.agentRole || (side === 'att' ? 'attacker' : side === 'def' ? 'defender' : 'arbiter'))],
    ['阶段', String(sourceEvent.data.stageId || sourceEvent.type)],
    ['关联', String(sourceEvent.data.correlationId || '—')],
    ['事件', sourceEvent.id],
    ['样本', String(sourceEvent.data.sampleId || '—')],
    ['提交', String(sourceEvent.data.submissionId || '—')],
    ['证据', evidenceIds.length ? evidenceIds.map(String).join('、') : '—'],
  ]
  auditValues.forEach(([label, value]) => {
    const item = document.createElement('span')
    item.textContent = `${label} ${value}`
    audit.appendChild(item)
  })
  const guide = timelineGuide(sourceEvent, description)
  const detail = document.createElement('div')
  detail.className = 'event-detail'
  detail.append(
    timelineDetail('输入', guide.input),
    timelineDetail('执行动作', guide.action),
    timelineDetail('具体输出', description),
    timelineDetail('状态', timelineStatusLabel(statusValue)),
    timelineDetail('评分影响', guide.score),
    timelineDetail('下一节点', guide.next),
  )
  const disclosure = document.createElement('details')
  disclosure.className = 'event-disclosure'
  disclosure.open = expanded
  const summary = document.createElement('summary')
  summary.textContent = '查看事件详情'
  disclosure.append(summary, timingRow, audit, detail)
  card.append(actor, name, desc, status, disclosure)
  event.appendChild(card)
  if (side !== 'judge') {
    const dot = document.createElement('span')
    dot.className = 'dot'
    event.appendChild(dot)
  }
    if (isNew) host.appendChild(event)
  // 让页面脚本根据用户是否正在手动查看时间线决定是否跟随到底部。
  // 直接设置 scrollTop 会覆盖用户滚轮位置，导致实时事件到来时强制跳到底部。
  window.dispatchEvent(new CustomEvent('battle-timeline:follow'))
}

function eventTitle(event: BattleEvent) {
  const stageId = String(event.data.stageId || '').toUpperCase()
  const attackStages: Record<string, string> = {
    A1: '读取战局配置', A2: '选择样本与攻击面', A3: '选择攻击意图与策略',
    A4: '构建攻击 Payload', A5: '授权与格式自检', A6: '相似度元数据校验',
    A7: '正式提交', A8: '结果接收与复盘',
  }
  if (/^A[1-8]$/.test(stageId)) return `${stageId} · ${attackStages[stageId]}`
  if (/^L[0-3]-\d+$/.test(stageId)) {
    const name = String(event.data.checkName || '').trim()
    return `${stageId}${name ? ` · ${name}` : ''}`
  }
  if (event.type === 'arbiter.layer.started' || (event.type === 'defense.layer.started' && /^L[0-3]$/.test(stageId))) return `${stageId} · Arbiter 开启层检测`
  if (event.type === 'arbiter.layer.confirmed') return `${stageId} · Arbiter 确认本层结果`
  if (event.type === 'arbiter.safe_control.started' || event.type === 'arbiter.safe_control') return 'Arbiter · 启动安全对照'
  if (event.type === 'arbiter.safe_control.verdict') return `Arbiter · 特征库动作（${String(event.data.featureAction || 'no-update')}）`
  if (event.type === 'defense.safe_control') return 'D-07 · 安全对照结果'
  if (event.type === 'agent.call.started' || event.type === 'agent.call.completed' || event.type === 'agent.call.failed') {
    const role = String(event.data.agentRole || '').toLowerCase() === 'defender' ? 'Defender' : 'Attacker'
    const phase = event.type.endsWith('.started') ? '调用开始' : event.type.endsWith('.failed') ? '调用失败' : '调用完成'
    return `${role} · 后端智能体${phase}`
  }
  return ({
    'battle.created': '战局已创建', 'battle.retry': '战局已重新提交', 'attack.started': '攻击阶段开始',
    'attack.sample.generated': '攻击方生成样本', 'attack.completed': '攻击样本生成完成', 'attack.compromised': '目标验证结果',
    'attack.stage.completed': '攻击阶段完成', 'attack.stage.failed': '攻击阶段失败',
    'round.started': '防守方开始检测', 'round.completed': '本轮检测完成',
    'defense.layer.started': '防御层检测开始', 'defense.check.started': '防御检查点开始',
    'defense.layer.verdict': '防御检查点裁决',
    'defense.completed': '防守分析完成', 'arbiter.similarity.checked': 'A6 · 相似度元数据校验',
    'arbiter.verdict': 'Arbiter · 最终分类',
    'arbiter.round.score': 'Arbiter · 本回合评分', 'arbiter.round.scored': 'Arbiter · 本回合评分',
    'round.settled': 'Arbiter · 本回合结算',
    'battle.completed': 'Arbiter · 整局结算完成', 'battle.failed': 'Arbiter · 战局执行失败',
  } as Record<string, string>)[event.type] || event.type
}

function eventDescription(event: BattleEvent) {
  const data = event.data
  const stageId = String(data.stageId || '').trim().toUpperCase()
  if (event.type === 'attack.stage.started' || event.type === 'attack.stage.completed' || event.type === 'attack.stage.failed') {
    const running = event.type === 'attack.stage.started'
    const suffix = running ? '执行中' : event.type === 'attack.stage.failed' ? '执行失败' : timelineStatusLabel(timelineStatus(event))
    if (stageId === 'A1') return `规则 ${text(data.rulesVersion || 'v2.0')} · 难度 ${text(data.difficulty)} · 总回合 ${text(data.roundLimit)} · ${suffix}`
    if (stageId === 'A2') return `样本 ${text(data.sampleId)} · 选择唯一攻击样本与目标面 · ${suffix}`
    if (stageId === 'A3') return `策略 ${text(data.tactic || data.scenario || data.objective || '待后端记录')} · ${suffix}`
    if (stageId === 'A4') return `${text(data.payloadType || 'synthetic')} Payload · 长度 ${text(data.contentLength)} · ${suffix}`
    if (stageId === 'A5') return `授权、真实目标、凭据、长度、编码与格式自检 · ${text(data.validationStatus || suffix)}`
    if (stageId === 'A7') return `提交 ${text(data.submissionId)} · ${data.accepted === false ? '未接受' : suffix}`
    if (stageId === 'A8') return `公开裁决 ${text(data.classification || data.verdict || '待公布')} · ${suffix}`
  }
  if (event.type === 'arbiter.round.score' || event.type === 'arbiter.round.scored') {
    const scores = data.scores && typeof data.scores === 'object' ? data.scores as Record<string, unknown> : {}
    const attacker = scoreValue(scores.attacker)
    const defender = scoreValue(scores.defender)
    return `Attacker ${attacker === null ? '证据不足' : attacker.toFixed(2)} · Defender ${defender === null ? '证据不足' : defender.toFixed(2)}`
  }
  if (typeof data.statement === 'string' && data.statement) return data.statement
  if (event.type === 'attack.sample.generated') return `第 ${text(data.round)} 轮样本已生成 · ${sourceLabel(String(data.attackerSource || ''))}`
  if (event.type === 'attack.completed') return `攻击方共生成 ${text(data.sampleCount)} 个样本 · ${sourceLabel(String(data.attackerSource || ''))}`
  if (event.type === 'round.started') return `正在检测第 ${text(data.round)} 轮 · ${sourceLabel(String(data.defenderSource || ''))}`
  if (event.type === 'round.completed') return `命中 ${Array.isArray(data.caught) ? data.caught.length : 0} 条规则，记录 ${Array.isArray(data.risks) ? data.risks.length : 0} 条风险，提出 ${Array.isArray(data.fixed) ? data.fixed.length : 0} 条建议`
  if (event.type === 'defense.layer.started') return `${text(data.layer || data.stageId)} · 开始检查 ${Array.isArray(data.applicableChecks) ? data.applicableChecks.length : 0} 项`
  if (event.type === 'defense.check.started') return `${text(data.checkDescription || data.checkName || '执行当前检查点')} · 进行中`
  if (event.type === 'defense.layer.verdict') {
    const detail = String(data.checkDescription || '')
    return `${detail}${detail ? ' · ' : ''}${timelineStatusLabel(timelineStatus(event))}`
  }
  if (event.type === 'agent.call.started' || event.type === 'agent.call.completed' || event.type === 'agent.call.failed') {
    const role = String(data.agentRole || '').toLowerCase() === 'defender' ? 'Defender' : 'Attacker'
    const stage = text(data.stageId || (role === 'Defender' ? 'DEFENSE' : 'A2'))
    const source = text(data.resultSource || data.agentSource || data.dispatchMode)
    const duration = Number(data.durationMs)
    const elapsed = Number.isFinite(duration) && duration >= 0 ? ` · 耗时 ${duration} ms` : ''
    if (event.type.endsWith('.started')) return `${role} 后端调用已发起 · 阶段 ${stage} · ${text(data.dispatchMode || '未记录')}`
    if (event.type.endsWith('.failed')) return `${role} 后端调用失败 · 阶段 ${stage} · ${text(data.errorType || data.error || '未提供失败原因')}${elapsed}`
    return `${role} 后端调用已完成 · 阶段 ${stage} · 来源 ${source}${elapsed}`
  }
  if (event.type === 'arbiter.similarity.checked') {
    const similarity = typeof data.maxHistoricalSimilarity === 'number'
      ? data.maxHistoricalSimilarity.toFixed(3)
      : typeof data.similarity === 'number' ? data.similarity.toFixed(3) : '—'
    const previous = typeof data.similarityToPrevious === 'number' ? data.similarityToPrevious.toFixed(3) : '—'
    return `历史最大相似度 ${similarity} · 上一回合 ${previous} · 阈值 0.850 · ${text(data.sourceType || 'unresolved')}`
  }
  if (event.type === 'arbiter.layer.started') return `${text(data.layer || data.stageId)} 层检测已开启，等待 Defender 按顺序提交检查证据`
  if (event.type === 'arbiter.layer.confirmed') return `确认 ${text(data.layer || data.stageId)} 必要检查全部通过，证据完整`
  if (event.type === 'arbiter.verdict') return `最终分类：${text(data.classification || event.status)}`
  if (event.type === 'arbiter.safe_control.verdict') {
    const action = String(data.featureAction || 'no-update')
    return action === 'update-pending-review'
      ? `特征库动作：update-pending-review · ${String(data.featureActionReason || '特征候选进入待审核队列')}`
      : `特征库动作：${action} · ${String(data.featureActionReason || '不更新特征库')}`
  }
  if (
    event.type === 'defense.safe_control'
    || event.type === 'arbiter.safe_control'
    || event.type === 'arbiter.safe_control.started'
    || event.type === 'safe_control'
  ) {
    const result = String(data.classification || data.status || event.status || '').toLowerCase()
    const allowed = result === 'passed' || result === 'allow' || result === 'allowed' || result === '放行'
    if (result === 'pending' || result === 'running' || !result) return '安全对照测试：正常样本检测中'
    return allowed
      ? '安全对照测试：正常样本正确放行 · D-07=15 · 不改变攻击样本最终分类'
      : '安全对照测试：正常样本被误拦截 · false-positive · D-07=0'
  }
  if (event.type === 'attack.compromised') {
    return data.simulated === true
      ? '模拟验证证据；不代表真实目标沦陷'
      : data.targetVerified === true ? '已记录目标验证证据' : '未取得目标验证证据'
  }
  if (event.type === 'round.settled') return `回合结果已冻结 · ${text(data.classification || event.status)}`
  if (event.type === 'battle.completed') return `全部有效回合已完成，整局结果已保存至历史记录`
  if (event.type === 'battle.failed') return String(data.error || '后端执行失败')
  return `状态：${event.status}`
}

function emit3dEvent(event: BattleEvent, round: number) {
  const bus = window.BattleEventBus
  if (!bus) return
  const projected = liveLifecycleProjector.push(event)
  projected.forEach((item, index) => {
    bus.emit({
      ...item,
      round: item.round || round,
      source: 'live',
      mock: false,
      status: item.status || event.status,
      eventId: `backend-${event.id}-${index}`,
      occurredAt: event.createdAt,
    })
  })
}

function bridge3dEvent(event: BattleEvent, round: number): Promise<void> {
  if (!slowPlayback) {
    emit3dEvent(event, round)
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    threePlaybackQueue.push({ event, round, resolve })
    drain3dPlayback()
  })
}

async function finishLiveBattle(event: BattleEvent) {
  // 战局完成事件可能先于慢速视觉队列到达；先让展示队列播放完，再刷新历史详情。
  await waitForTimelinePlayback()
  element('liveStatus').classList.remove('run')
  element('liveStatus').textContent = event.type === 'battle.completed' ? '真实战局已完成' : '真实战局执行失败'
  try {
    const battle = await json<Battle>(`/battles/${encodeURIComponent(event.battleId)}`)
    state.selected = battle
    renderBattleDetail(battle)
    const completedRounds = battle.attackerOut?.samples?.length || 0
    const totalRounds = Number(battle.rounds) || state.requestedRounds || completedRounds || 3
    element('liveRounds').textContent = `${completedRounds}/${totalRounds}`
    await Promise.all([loadSummary(), loadHistory(0)])
  } catch (error) { showToast(`结果刷新失败：${errorText(error)}`) }
}

async function exportReport() {
  if (!state.selected) return showToast('请先选择一场真实战局')
  try {
    const response = await request(`/reports/${encodeURIComponent(state.selected.id)}?format=markdown`, { headers: { Accept: 'text/markdown' } })
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${state.selected.id}.md`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    showToast('真实战报已导出')
  } catch (error) { showToast(`导出失败：${errorText(error)}`) }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]!)
}

function installControls() {
  intercept(element('healthBtn'), 'click', () => void checkHealth())
  intercept(element('btnStart'), 'click', () => void startBattle())
  intercept(element('prevPage'), 'click', () => { if (state.page > 0) void loadHistory(state.page - 1) })
  intercept(element('nextPage'), 'click', () => { if ((state.page + 1) * PAGE_SIZE < state.total) void loadHistory(state.page + 1) })
  intercept(element('exportBtn'), 'click', () => void exportReport())
  intercept(element('deleteBtn'), 'click', () => showToast('后端尚未提供删除战局接口，前端不会伪删除真实数据'))
  const slowToggle = element<HTMLInputElement>('slowPlaybackToggle')
  slowPlayback = slowToggle.checked
  intercept(slowToggle, 'change', () => {
    setSlowPlayback(slowToggle.checked)
    slowToggle.setAttribute('aria-checked', String(slowToggle.checked))
  })
  const search = element<HTMLInputElement>('logInput')
  intercept(search, 'input', () => {
    window.clearTimeout(state.searchTimer)
    state.searchTimer = window.setTimeout(() => { state.query = search.value.trim(); void loadHistory(0) }, 260)
  })
  const filter = element<HTMLSelectElement>('diffFilter')
  intercept(filter, 'change', () => {
    state.difficulty = ({ '低': 'low', '中': 'mid', '高': 'high' } as Record<string, Difficulty>)[filter.value] || ''
    void loadHistory(0)
  })
  const memory = element<HTMLInputElement>('memToggle')
  memory.checked = false
  memory.disabled = true
  memory.title = '后端尚未提供跨局记忆接口'
  element<HTMLButtonElement>('memClear').disabled = true
  element<HTMLButtonElement>('deleteBtn').disabled = true
  element<HTMLButtonElement>('deleteBtn').textContent = '后端暂不支持删除'
}

async function initialize() {
  installControls()
  installSessionDialog()
  await checkHealth()
  const canUse = await checkSession()
  if (canUse) await Promise.all([loadSummary(), loadHistory(0)])
  else showLogin('首次使用请先登录，登录后才能准备和创建战局')
}

void initialize()

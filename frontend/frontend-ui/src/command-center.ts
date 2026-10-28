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
  starting: false,
  searchTimer: 0,
}

let visualizationRequestGeneration = 0
let liveTimelineProjector = new LiveBattleTimelineProjector()
let liveLifecycleProjector = new LiveBattleLifecycleProjector()

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
    .agent-login-mask{position:fixed;inset:0;z-index:2000;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(2,5,12,.78);backdrop-filter:blur(8px)}
    .agent-login-mask.open{display:flex}.agent-login-box{width:min(420px,100%);border:1px solid #35475d;border-radius:10px;background:#101722;padding:20px;box-shadow:0 20px 70px rgba(0,0,0,.62)}
    .agent-login-box h2{font-size:18px;margin:0 0 5px}.agent-login-box p{color:#8fa0b2;font-size:12px;margin:0 0 15px}.agent-login-box input{margin-bottom:10px}.agent-login-actions{display:flex;justify-content:flex-end;gap:8px}.agent-login-error{min-height:18px;color:#ff8f6b;font-size:12px;margin-bottom:8px}
    .agent-session-logout{display:none;border:1px solid #35475d;border-radius:6px;background:#101722;color:#9fb0c2;padding:7px 11px;font-size:12px;cursor:pointer}.agent-session-logout:hover{border-color:#59738f;color:#fff}
  `
  document.head.appendChild(style)
  const mask = document.createElement('div')
  mask.id = 'agentLoginMask'
  mask.className = 'agent-login-mask'
  mask.innerHTML = `<form class="agent-login-box" id="agentLoginForm"><h2>登录攻防实验室</h2><p>密码只发送给后端换取 HttpOnly 会话，不会存入网页或浏览器存储。</p><input id="agentLoginPassword" type="password" autocomplete="current-password" placeholder="浏览器访问密码" required maxlength="256"><div class="agent-login-error" id="agentLoginError"></div><div class="agent-login-actions"><button type="submit" class="btn-ready" style="width:auto;padding:9px 24px">登录</button></div></form>`
  document.body.appendChild(mask)
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
}

function updateSessionControls(enabled: boolean, authenticated: boolean) {
  state.sessionEnabled = enabled
  const logout = element<HTMLButtonElement>('agentSessionLogout')
  logout.style.display = enabled && authenticated ? 'inline-flex' : 'none'
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
  if (count) count.textContent = `${samples.length} rounds`
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

function publishBattleVisualizations(rounds: readonly BattleVisualizationRound[], status: 'loading' | 'ready' | 'unavailable') {
  window.dispatchEvent(new CustomEvent('battle-visualizations:update', {
    detail: { ...buildBattleVisualizations(rounds), status },
  }))
}

async function refreshBattleVisualizations(battleId: string) {
  const requestGeneration = ++visualizationRequestGeneration
  try {
    const result = await json<{ rounds?: (BattleVisualizationRound & BattleRoundScore)[] }>(`/battles/${encodeURIComponent(battleId)}/rounds`)
    if (state.selected?.id !== battleId || requestGeneration !== visualizationRequestGeneration) return
    renderRoundScoreDetails(result.rounds || [])
    publishBattleVisualizations(Array.isArray(result.rounds) ? result.rounds : [], 'ready')
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
  const groups: Array<[string, string]> = [['process', '流程规范 / 40'], ['effect', '实际效果 / 60'], ['response', '响应 / 100']]
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
    summary.textContent = '评分细则（流程 40 + 效果 60 = 总分；响应分为独立诊断指标）'
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
      column.appendChild(scoreRow('响应分（不计入总分）', values.responseScore, 100))
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
  state.selected = battle
  liveTimelineProjector = new LiveBattleTimelineProjector()
  liveLifecycleProjector = new LiveBattleLifecycleProjector()
  publishBattleVisualizations([], 'loading')
  const roundLimit = Number(battle.rounds) || 3
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
  if (event.type === 'attack.sample.generated') appendLivePayload(event, round)
  const entries = liveTimelineProjector.push(event)
  if (event.type.startsWith('agent.call.')) {
    const role = event.data.agentRole === 'defender' ? '防守方' : '攻击方'
    const state = event.type.endsWith('.started') ? '处理中' : event.type.endsWith('.failed') ? '调用失败' : '已完成'
    element('liveStatus').textContent = `${role}智能体${state}`
  }
  for (const entry of entries) {
    if (entry.kind === 'round') {
      ensureRound(entry.round)
      element('liveRounds').textContent = `${entry.round}/${state.selected?.rounds || '—'}`
      continue
    }
    appendTimeline(
      entry.side,
      eventTitle(entry.event),
      eventDescription(entry.event),
      entry.event.createdAt,
      eventTiming(entry.event),
      Array.isArray(entry.event.data.evidenceIds) ? entry.event.data.evidenceIds : [],
    )
    element('liveStatus').textContent = eventTitle(entry.event)
  }
  bridge3dEvent(event, round)
  if (event.type === 'round.completed') void refreshBattleVisualizations(event.battleId)
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

function appendTimeline(
  side: 'att' | 'def' | 'judge',
  title: string,
  description: string,
  createdAt: string,
  timing?: { startedAt: string; endedAt: string; responseMs: number },
  evidenceIds: unknown[] = [],
) {
  const event = document.createElement('div')
  event.className = `event ${side}`
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
  const meta = document.createElement('div')
  meta.className = 'meta'
  const start = timing?.startedAt ? formatTime(timing.startedAt) : ''
  const end = timing?.endedAt ? formatTime(timing.endedAt) : ''
  const response = Number.isFinite(timing?.responseMs) && (timing?.responseMs ?? 0) >= 0
    ? `响应 ${(timing!.responseMs / 1000).toFixed(2)}s`
    : ''
  meta.textContent = start || end || response
    ? `开始 ${start || '—'} · 结束 ${end || '—'} · ${response || '响应 —'}`
    : formatTime(createdAt)
  card.append(actor, name, desc, meta)
  if (evidenceIds.length) {
    const evidence = document.createElement('div')
    evidence.className = 'meta'
    evidence.textContent = `证据：${evidenceIds.map(String).join('、')}`
    card.appendChild(evidence)
  }
  event.appendChild(card)
  if (side !== 'judge') {
    const dot = document.createElement('span')
    dot.className = 'dot'
    event.appendChild(dot)
  }
  element('tlContent').appendChild(event)
  const stream = element<HTMLDivElement>('tlStream')
  stream.scrollTop = stream.scrollHeight
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
  if (event.type === 'arbiter.layer.started') return `${stageId} 层检测开始`
  return ({
    'battle.created': '战局已创建', 'battle.retry': '战局已重新提交', 'attack.started': '攻击阶段开始',
    'attack.sample.generated': '攻击方生成样本', 'attack.completed': '攻击样本生成完成', 'attack.compromised': '目标验证结果',
    'attack.stage.completed': '攻击阶段完成', 'attack.stage.failed': '攻击阶段失败',
    'round.started': '防守方开始检测', 'round.completed': '本轮检测完成',
    'defense.layer.started': '防御层检测开始', 'defense.check.started': '防御检查点开始',
    'defense.layer.verdict': '防御检查点裁决', 'defense.safe_control': '安全对照测试',
    'defense.completed': '防守分析完成', 'arbiter.similarity.checked': 'A6 · 相似度元数据校验',
    'arbiter.layer.confirmed': 'Arbiter · 确认本层结果', 'arbiter.verdict': 'Arbiter · 最终分类',
    'arbiter.safe_control': 'Arbiter · 安全对照测试', 'arbiter.round.scored': 'Arbiter · 本回合评分',
    'round.settled': '本回合已结算', 'battle.completed': '战局完成', 'battle.failed': '战局失败',
  } as Record<string, string>)[event.type] || event.type
}

function eventDescription(event: BattleEvent) {
  const data = event.data
  if (event.type === 'arbiter.round.scored') {
    const scores = data.scores && typeof data.scores === 'object' ? data.scores as Record<string, unknown> : {}
    return `Attacker ${text(scores.attacker)} · Defender ${text(scores.defender)}`
  }
  if (typeof data.statement === 'string' && data.statement) return data.statement
  if (event.type === 'attack.sample.generated') return `第 ${text(data.round)} 轮样本已生成 · ${sourceLabel(String(data.attackerSource || ''))}`
  if (event.type === 'attack.completed') return `攻击方共生成 ${text(data.sampleCount)} 个样本 · ${sourceLabel(String(data.attackerSource || ''))}`
  if (event.type === 'round.started') return `正在检测第 ${text(data.round)} 轮 · ${sourceLabel(String(data.defenderSource || ''))}`
  if (event.type === 'round.completed') return `命中 ${Array.isArray(data.caught) ? data.caught.length : 0} 条规则，记录 ${Array.isArray(data.risks) ? data.risks.length : 0} 条风险，提出 ${Array.isArray(data.fixed) ? data.fixed.length : 0} 条建议`
  if (event.type === 'defense.layer.started') return `${text(data.layer || data.stageId)} · 开始检查 ${Array.isArray(data.applicableChecks) ? data.applicableChecks.length : 0} 项`
  if (event.type === 'defense.layer.verdict') {
    const detail = String(data.checkDescription || '')
    return `${detail}${detail ? ' · ' : ''}${statusLabel((event.status || data.status || 'pending') as Battle['status'])}`
  }
  if (event.type === 'arbiter.similarity.checked') {
    const similarity = typeof data.similarity === 'number' ? data.similarity.toFixed(3) : 'baseline'
    return `与上一轮 Payload 相似度 ${similarity} · 阈值 0.850 · ${text(data.sourceType || 'unresolved')}`
  }
  if (event.type === 'arbiter.layer.confirmed') return `确认第 ${text(data.layerIndex)} 层证据完整`
  if (event.type === 'arbiter.verdict') return `最终分类：${text(data.classification || event.status)}`
  if (event.type === 'defense.safe_control') return String(data.statement || `正常样本判定：${text(data.classification || event.status)}`)
  if (event.type === 'attack.compromised') {
    return data.simulated === true
      ? '模拟验证证据；不代表真实目标沦陷'
      : data.targetVerified === true ? '已记录目标验证证据' : '未取得目标验证证据'
  }
  if (event.type === 'battle.failed') return String(data.error || '后端执行失败')
  return `状态：${event.status}`
}

function bridge3dEvent(event: BattleEvent, round: number) {
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

async function finishLiveBattle(event: BattleEvent) {
  element('liveStatus').classList.remove('run')
  element('liveStatus').textContent = event.type === 'battle.completed' ? '真实战局已完成' : '真实战局执行失败'
  try {
    const battle = await json<Battle>(`/battles/${encodeURIComponent(event.battleId)}`)
    state.selected = battle
    renderBattleDetail(battle)
    element('liveRounds').textContent = `${battle.attackerOut?.samples?.length || 0}/${battle.attackerOut?.samples?.length || 0}`
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
  if (await checkSession()) await Promise.all([loadSummary(), loadHistory(0)])
}

void initialize()

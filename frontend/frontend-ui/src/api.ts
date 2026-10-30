export type Difficulty = 'low' | 'mid' | 'high'
export type AgentSource = 'acp-llm' | 'acp-rule-fallback' | 'local-rule' | (string & {})

export type Sample = {
  type: string
  topic?: string
  severity: string
  content: string
  testCaseId?: string
  scenario?: string
  objective?: string
  simulation?: boolean
}
export type Defense = {
  agentSource?: AgentSource
  caught?: Array<{ reason?: string; type?: string }>
  risks?: Array<{ reason?: string; level?: string }>
  fixed?: Array<{ action?: string; status?: string }>
  verificationStatus?: string
  scopeNotice?: string
}
export type DashboardSummary = {
  totalBattles: number
  completedBattles: number
  failedBattles: number
  highDifficultyBattles: number
  sampleCount: number
  ruleHitCount: number
  riskCount: number
  recommendationCount: number
  simulationSampleCount: number
  acpCallBattles: number
  ruleLibraryCaseCount: number
  attackGenerated?: number
  defenderDetected?: number
  fixesSuggested?: number
  strategyChecks?: number
}
export type Battle = {
  id: string
  code?: string | null
  difficulty: Difficulty
  topic: string
  status: string
  createdAt: string
  attackerOut: { agentSource?: AgentSource; samples: Sample[] }
  defenderOut: Defense[]
}

export type BrowserSession = {
  enabled: boolean
  authenticated: boolean
}

export type ExternalCase = {
  externalId: string
  vendorProject: string
  product: string
  title: string
  dateAdded: string
  dueDate?: string | null
  description: string
  requiredAction: string
  knownRansomwareUse?: string | null
  forensicTriage?: string | null
  notes?: string | null
  cwes: string[]
  sourceUrl: string
  provenanceStatus: string
  synthetic: boolean
  recordKind: string
  source: {
    publisher: string
    sourceType: string
    catalogVersion: string
    releasedAt?: string | null
    retrievedAt: string
    contentSha256: string
  }
}

export type ExternalCaseResponse = {
  available: boolean
  reason?: string
  items: ExternalCase[]
  total: number
  sourceCount: number
}

export type ScoreCategory = {
  id?: string
  label: string
  score: number
  maxScore: number
  basis?: string
  group?: string
}

export type RoleScore = {
  status: string
  score: number | null
  maxScore: number
  message?: string
  categories: ScoreCategory[]
  summary?: {
    processScore: number
    effectScore: number
    responseScore: number
    responseMaxScore?: number
    responseGrade?: string
    responseAverageMs?: number | null
    responseScoredRounds?: number[]
    baseScore: number
    finalScore: number
  }
}

export type BattleScore = {
  version: string
  status: string
  message?: string
  attacker: RoleScore
  defender: RoleScore
}

export class ApiError extends Error {
  readonly status: number
  readonly requestId?: string

  constructor(status: number, message: string, requestId?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.requestId = requestId
  }
}

const localBrowserHosts = new Set(['localhost', '127.0.0.1', '::1'])
const PRODUCTION_API_BASE = 'https://api.yuanyiagentzhandui.cn'
const productionHosts = new Set(['yuanyiagentzhandui.cn', 'www.yuanyiagentzhandui.cn'])

/**
 * 解析实际使用的 API 基址。
 *
 * 构建脚本按 `CF_PAGES_BRANCH === 'main'` 决定用生产还是预览 API；当 Pages 项目
 * 的 production 分支不是 main 时，正式域名会拿到 `preview-api.*`，表现成
 * “无法连接后端服务，请检查 API 地址和服务状态”，但后端其实是通的。
 *
 * 纠偏只对正式站点域名生效，预览子域的隔离语义保持不变。
 */
export function resolveApiBase(injected: string | undefined, hostname: string): string {
  const trimmed = injected?.trim()
  const corrected =
    productionHosts.has(hostname) && trimmed && trimmed.includes('preview-api') ? PRODUCTION_API_BASE : trimmed
  return (corrected || (localBrowserHosts.has(hostname) ? 'http://127.0.0.1:8787' : '')).replace(/\/$/, '')
}

const currentBrowserHost = typeof window === 'undefined' ? 'localhost' : window.location.hostname
const API_BASE = resolveApiBase(import.meta.env.VITE_AGENT_API, currentBrowserHost)

function detailText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return undefined
  const messages = value
    .map((item) => (item && typeof item === 'object' && 'msg' in item ? String(item.msg) : ''))
    .filter(Boolean)
  return messages.length ? messages.join('；') : undefined
}

async function request(path: string, options?: RequestInit): Promise<Response> {
  if (!API_BASE) {
    throw new ApiError(0, '当前预览尚未配置隔离 API，请联系部署负责人')
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
    })
  } catch {
    throw new ApiError(0, '无法连接后端服务，请检查 API 地址和服务状态')
  }

  if (!response.ok) {
    let detail: string | undefined
    try {
      const body = await response.json() as { detail?: unknown }
      detail = detailText(body.detail)
    } catch {
      // Gateways may return an empty or non-JSON error body.
    }
    throw new ApiError(response.status, errorMessage(response.status, detail), response.headers.get('X-Request-ID') ?? undefined)
  }

  return response
}

async function responseJson<T>(response: Response): Promise<T> {
  try {
    return await response.json() as T
  } catch {
    throw new ApiError(response.status, '后端返回了无效响应', response.headers.get('X-Request-ID') ?? undefined)
  }
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  return responseJson<T>(await request(path, options))
}

export type ApiDownload = { blob: Blob; filename: string; total: number }

/**
 * 下载二进制/文本附件（如 CSV 导出）。
 *
 * 走统一的 ``request``，因此错误码、超时提示与其它接口一致；
 * 文件名优先取 ``Content-Disposition``，缺失时由调用方兜底。
 */
export async function apiDownload(path: string): Promise<ApiDownload> {
  const response = await request(path)
  const blob = await response.blob()
  const disposition = response.headers.get('Content-Disposition') ?? ''
  const matched = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)
  const totalHeader = response.headers.get('X-Total-Count')
  const total = totalHeader === null ? Number.NaN : Number(totalHeader)
  return {
    blob,
    filename: matched ? decodeURIComponent(matched[1].trim()) : '',
    total: Number.isFinite(total) && total >= 0 ? total : Number.NaN,
  }
}

export async function apiPage<T>(path: string): Promise<{ items: T[]; total: number }> {
  const response = await request(path)
  const items = await responseJson<T[]>(response)
  const rawTotal = response.headers.get('X-Total-Count')
  const headerTotal = rawTotal === null ? Number.NaN : Number(rawTotal)
  return { items, total: Number.isFinite(headerTotal) && headerTotal >= 0 ? headerTotal : items.length }
}

export async function apiCursorPage<T>(path: string): Promise<{
  items: T[]
  total: number
  hasMore: boolean
  nextSequence?: number
}> {
  const response = await request(path)
  const items = await responseJson<T[]>(response)
  const totalHeader = response.headers.get('X-Total-Count')
  const nextHeader = response.headers.get('X-Next-Sequence')
  const totalValue = totalHeader === null ? Number.NaN : Number(totalHeader)
  const nextValue = nextHeader === null ? Number.NaN : Number(nextHeader)
  return {
    items,
    total: Number.isFinite(totalValue) && totalValue >= 0 ? totalValue : items.length,
    hasMore: response.headers.get('X-Has-More') === 'true',
    nextSequence: Number.isFinite(nextValue) ? nextValue : undefined,
  }
}

export async function getBrowserSession(): Promise<BrowserSession> {
  return api<BrowserSession>('/auth/session')
}

export async function getExternalCases(query = ''): Promise<ExternalCaseResponse> {
  const suffix = query.trim() ? `?q=${encodeURIComponent(query.trim())}&limit=5` : '?limit=5'
  return api<ExternalCaseResponse>(`/external-cases${suffix}`)
}

export async function getBattle(battleId: string): Promise<Battle> {
  return api<Battle>(`/battles/${encodeURIComponent(battleId)}`)
}

export async function getBattleScore(battleId: string): Promise<BattleScore> {
  return api<BattleScore>(`/battles/${encodeURIComponent(battleId)}/score`)
}

export async function deleteBattle(battleId: string): Promise<void> {
  await request(`/battles/${encodeURIComponent(battleId)}`, { method: 'DELETE' })
}

export async function retryBattle(battleId: string): Promise<Battle> {
  return api<Battle>(`/battles/${encodeURIComponent(battleId)}/retry`, { method: 'POST' })
}

export function errorMessage(status: number, detail?: string): string {
  if (status === 400 || status === 422) return detail ? `输入不符合要求：${detail}` : '输入不符合要求，请检查主题和难度'
  if (status === 401 || status === 403) return detail || '需要登录后台或提供有效凭证后才能执行此操作'
  if (status === 404) return '战局不存在或已被删除'
  if (status === 409) return detail || '当前战局状态不允许此操作'
  // 5xx 带上后端 detail：像「缺中文字体」「依赖未安装」这类原因，泛化提示会掩盖掉，
  // 排查时只能翻服务器日志。没有 detail 时仍用通用文案。
  if (status >= 500) return detail ? `服务暂时不可用：${detail}` : '服务暂时不可用，请稍后重试'
  return detail || `请求失败（HTTP ${status}）`
}

export function apiErrorMessage(error: unknown, fallback = '操作失败，请稍后重试'): string {
  return error instanceof ApiError ? error.message : error instanceof Error && error.message ? error.message : fallback
}


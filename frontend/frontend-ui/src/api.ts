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
}
export type Battle = {
  id: string
  difficulty: Difficulty
  topic: string
  status: string
  createdAt: string
  attackerOut: { agentSource?: AgentSource; samples: Sample[] }
  defenderOut: Defense[]
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

const API_BASE = (import.meta.env.VITE_AGENT_API ?? 'http://127.0.0.1:8787').replace(/\/$/, '')

function detailText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return undefined
  const messages = value
    .map((item) => (item && typeof item === 'object' && 'msg' in item ? String(item.msg) : ''))
    .filter(Boolean)
  return messages.length ? messages.join('；') : undefined
}

async function request(path: string, options?: RequestInit): Promise<Response> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
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

export async function apiPage<T>(path: string): Promise<{ items: T[]; total: number }> {
  const response = await request(path)
  const items = await responseJson<T[]>(response)
  const rawTotal = response.headers.get('X-Total-Count')
  const headerTotal = rawTotal === null ? Number.NaN : Number(rawTotal)
  return { items, total: Number.isFinite(headerTotal) && headerTotal >= 0 ? headerTotal : items.length }
}

export function errorMessage(status: number, detail?: string): string {
  if (status === 400 || status === 422) return detail ? `输入不符合要求：${detail}` : '输入不符合要求，请检查主题和难度'
  if (status === 404) return '战局不存在或已被删除'
  if (status >= 500) return '服务暂时不可用，请稍后重试'
  return detail || `请求失败（HTTP ${status}）`
}

export function apiErrorMessage(error: unknown, fallback = '操作失败，请稍后重试'): string {
  return error instanceof ApiError ? error.message : error instanceof Error && error.message ? error.message : fallback
}


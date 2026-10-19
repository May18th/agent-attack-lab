import {
  api,
  apiCursorPage,
  apiPage,
  ApiError,
  type Battle,
  type BattleScore,
  type BrowserSession,
  type DashboardSummary,
  type ExternalCaseResponse,
} from './api'

export { apiErrorMessage } from './api'

export type AdminSession = BrowserSession
export type AdminBattle = Battle
export type AdminBattleListFilters = {
  limit?: number
  offset?: number
  status?: string
  q?: string
}
export type AdminBattlePage = { items: AdminBattle[]; total: number }
export type AdminBattleDetail = AdminBattle
export type AdminBattleAudit = Record<string, unknown>
export type AdminBattleEvent = {
  type?: string
  eventType?: string
  status?: string
  sequence?: number
  timestamp?: string
  data?: Record<string, unknown>
  [key: string]: unknown
}
export type AdminBattleEvents = AdminBattleEvent[]
export type AdminBattleEventPage = { items: AdminBattleEvents; total: number; hasMore: boolean; nextSequence?: number }
export type AdminBattleScore = BattleScore
export type AdminDashboardSummary = DashboardSummary & Record<string, number>
export type AdminMetrics = Record<string, unknown>
export type AdminExternalCasesFilters = { limit?: number; q?: string }
export type AdminExternalCases = ExternalCaseResponse
export type AdminReport = Record<string, unknown>

function battlePath(battleId: string, suffix = ''): string {
  return `/battles/${encodeURIComponent(battleId)}${suffix}`
}

function queryString(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && String(value).trim() !== '') params.set(key, String(value))
  }
  const encoded = params.toString()
  return encoded ? `?${encoded}` : ''
}

export function getAdminSession(): Promise<AdminSession> {
  return api<AdminSession>('/auth/session')
}

export async function logoutAdminSession(): Promise<void> {
  try {
    await api<unknown>('/auth/session', { method: 'DELETE' })
  } catch (error) {
    // api.ts parses 204 responses through response.json(); a successful logout has no body.
    if (!(error instanceof ApiError) || error.status !== 204) throw error
  }
}

export function listAdminBattles(filters: AdminBattleListFilters = {}): Promise<AdminBattlePage> {
  return apiPage<AdminBattle>(`/battles${queryString(filters)}`)
}

export function getAdminBattleDetail(battleId: string): Promise<AdminBattleDetail> {
  return api<AdminBattleDetail>(battlePath(battleId))
}

export function getAdminBattleAudit(battleId: string): Promise<AdminBattleAudit> {
  return api<AdminBattleAudit>(battlePath(battleId, '/audit'))
}

export function getAdminBattleEvents(battleId: string, afterSequence = 0): Promise<AdminBattleEventPage> {
  return apiCursorPage<AdminBattleEvent>(`${battlePath(battleId, '/events')}${queryString({ after_sequence: afterSequence, limit: 200 })}`)
}

export function getAdminBattleScore(battleId: string): Promise<AdminBattleScore> {
  return api<AdminBattleScore>(battlePath(battleId, '/score'))
}

export function getAdminDashboardSummary(): Promise<AdminDashboardSummary> {
  return api<AdminDashboardSummary>('/dashboard/summary')
}

export function getAdminMetrics(): Promise<AdminMetrics> {
  return api<AdminMetrics>('/metrics')
}

export function getAdminExternalCases(filters: AdminExternalCasesFilters = {}): Promise<AdminExternalCases> {
  return api<AdminExternalCases>(`/external-cases${queryString({ limit: filters.limit, q: filters.q })}`)
}

export function retryAdminBattle(battleId: string): Promise<AdminBattle> {
  return api<AdminBattle>(battlePath(battleId, '/retry'), { method: 'POST' })
}

export function cancelAdminBattle(battleId: string): Promise<AdminBattle> {
  return api<AdminBattle>(battlePath(battleId, '/cancel'), { method: 'POST' })
}

export async function deleteAdminBattle(battleId: string): Promise<void> {
  try {
    await api<unknown>(battlePath(battleId), { method: 'DELETE' })
  } catch (error) {
    // api.ts parses 204 responses through response.json(); preserve successful deletes.
    if (!(error instanceof ApiError) || error.status !== 204) throw error
  }
}

export function getAdminReport(battleId: string): Promise<AdminReport> {
  return api<AdminReport>(`${battlePath(battleId, '/report')}?format=json`)
}

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
export type AdminBattle = Battle & {
  rounds?: number
  verdict?: 'attacker_won' | 'defender_won' | 'undetermined' | null
}
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
export type AdminSample = { id: string; topic: string; content: string; source: string; useCount: number; createdAt: string; updatedAt: string }
export type AdminRule = { id: string; name: string; condition: string; action: '拦截' | '放行'; hitCount: number; createdAt: string; updatedAt: string }
export type AdminAuditLog = { id: string; eventType: string; requestId?: string; battleId?: string; actorRole?: string; status: string; createdAt: string; data: Record<string, unknown> }

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

export function loginAdminSession(password: string): Promise<void> {
  return api('/auth/session', { method: 'POST', body: JSON.stringify({ password }) }).then(() => undefined)
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

export function createAdminBattle(payload: { topic: string; difficulty: 'low' | 'mid' | 'high'; rounds: number }): Promise<AdminBattle> {
  return api<AdminBattle>(`/battles?background=true`, { method: 'POST', body: JSON.stringify(payload) })
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

export function listAdminSamples(q = ''): Promise<{ items: AdminSample[]; total: number }> {
  return apiPage<AdminSample>(`/admin/samples${queryString({ q, limit: 200 })}`)
}

export function createAdminSample(payload: Pick<AdminSample, 'topic' | 'content' | 'source'>): Promise<AdminSample> {
  return api<AdminSample>('/admin/samples', { method: 'POST', body: JSON.stringify(payload) })
}

export function updateAdminSample(id: string, payload: Pick<AdminSample, 'topic' | 'content' | 'source'>): Promise<AdminSample> {
  return api<AdminSample>(`/admin/samples/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) })
}

export async function deleteAdminSample(id: string): Promise<void> {
  try { await api<unknown>(`/admin/samples/${encodeURIComponent(id)}`, { method: 'DELETE' }) } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 204) throw error
  }
}

export function listAdminRules(q = ''): Promise<{ items: AdminRule[]; total: number }> {
  return apiPage<AdminRule>(`/admin/rules${queryString({ q, limit: 200 })}`)
}

export function createAdminRule(payload: Pick<AdminRule, 'name' | 'condition' | 'action'>): Promise<AdminRule> {
  return api<AdminRule>('/admin/rules', { method: 'POST', body: JSON.stringify(payload) })
}

export function updateAdminRule(id: string, payload: Pick<AdminRule, 'name' | 'condition' | 'action'>): Promise<AdminRule> {
  return api<AdminRule>(`/admin/rules/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) })
}

export async function deleteAdminRule(id: string): Promise<void> {
  try { await api<unknown>(`/admin/rules/${encodeURIComponent(id)}`, { method: 'DELETE' }) } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 204) throw error
  }
}

export function listAdminAuditLogs(filters: { from_time?: string; to_time?: string; user?: string; operation?: string } = {}): Promise<AdminAuditLog[]> {
  return api<AdminAuditLog[]>(`/admin/audit-logs${queryString(filters)}`)
}

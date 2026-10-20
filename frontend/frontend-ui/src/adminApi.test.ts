import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cancelAdminBattle,
  deleteAdminBattle,
  getAdminBattleAudit,
  getAdminBattleDetail,
  getAdminBattleEvents,
  getAdminBattleScore,
  getAdminDashboardSummary,
  getAdminExternalCases,
  getAdminMetrics,
  getAdminReport,
  getAdminSession,
  listAdminBattles,
  loginAdminSession,
  logoutAdminSession,
  retryAdminBattle,
} from './adminApi'

afterEach(() => vi.unstubAllGlobals())

function response(body: unknown, init: ResponseInit = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  })
}

describe('admin API', () => {
  it('gets the browser admin session with credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ enabled: true, authenticated: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getAdminSession()).resolves.toEqual({ enabled: true, authenticated: true })
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/auth/session'), expect.objectContaining({ credentials: 'include' }))
  })

  it('logs in with the browser admin password', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ authenticated: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(loginAdminSession('secret')).resolves.toBeUndefined()
    expect(fetchMock.mock.calls[0][0]).toContain('/auth/session')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ password: 'secret' }),
    })
  })

  it('lists battles with filters and parses the total header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response([{ id: 'b-1' }], { headers: { 'X-Total-Count': '9' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listAdminBattles({ limit: 10, offset: 20, status: 'failed', q: 'needle' })).resolves.toEqual({ items: [{ id: 'b-1' }], total: 9 })
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/battles\?limit=10&offset=20&status=failed&q=needle$/)
  })

  it.each([
    ['getAdminBattleDetail', getAdminBattleDetail, '/battles/b%2F1'],
    ['getAdminBattleAudit', getAdminBattleAudit, '/battles/b%2F1/audit'],
    ['getAdminBattleScore', getAdminBattleScore, '/battles/b%2F1/score'],
  ])('%s uses the battle endpoint', async (_name, fn, path) => {
    const fetchMock = vi.fn().mockResolvedValue(response({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fn('b/1')).resolves.toEqual({ ok: true })
    expect(fetchMock.mock.calls[0][0]).toContain(path)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include' })
  })

  it('loads a bounded event page and reads its cursor headers', async () => {
    const events = [{ sequence: 1, type: 'battle.created' }]
    const fetchMock = vi.fn().mockResolvedValue(response(events, { headers: {
      'X-Total-Count': '241',
      'X-Has-More': 'true',
      'X-Next-Sequence': '1',
    } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getAdminBattleEvents('b/1')).resolves.toEqual({ items: events, total: 241, hasMore: true, nextSequence: 1 })
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/battles\/b%2F1\/events\?after_sequence=0&limit=200$/)
  })

  it('loads dashboard, metrics and external cases', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ totalBattles: 3 }))
      .mockResolvedValueOnce(response({ requests: 4 }))
      .mockResolvedValueOnce(response({ available: true, items: [], total: 0, sourceCount: 0 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getAdminDashboardSummary()).resolves.toEqual({ totalBattles: 3 })
    await expect(getAdminMetrics()).resolves.toEqual({ requests: 4 })
    await expect(getAdminExternalCases({ limit: 25, q: 'CVE-1' })).resolves.toEqual({ available: true, items: [], total: 0, sourceCount: 0 })
    expect(fetchMock.mock.calls[2][0]).toMatch(/\/external-cases\?limit=25&q=CVE-1$/)
  })

  it.each([
    ['retry', retryAdminBattle, '/battles/b-1/retry'],
    ['cancel', cancelAdminBattle, '/battles/b-1/cancel'],
  ])('%s uses POST', async (_name, fn, path) => {
    const fetchMock = vi.fn().mockResolvedValue(response({ id: 'b-1' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fn('b-1')).resolves.toEqual({ id: 'b-1' })
    expect(fetchMock.mock.calls[0][0]).toContain(path)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', credentials: 'include' })
  })

  it('deletes a battle with DELETE', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(undefined, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(deleteAdminBattle('b/1')).resolves.toBeUndefined()
    expect(fetchMock.mock.calls[0][0]).toContain('/battles/b%2F1')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'DELETE', credentials: 'include' })
  })

  it('logs out through the API and accepts a 204 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(undefined, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(logoutAdminSession()).resolves.toBeUndefined()
    expect(fetchMock.mock.calls[0][0]).toContain('/auth/session')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'DELETE', credentials: 'include' })
  })

  it('requests JSON reports and preserves ApiError failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ report: true }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(getAdminReport('b-1')).resolves.toEqual({ report: true })
    expect(fetchMock.mock.calls[0][0]).toContain('/battles/b-1/report?format=json')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ detail: 'denied' }, { status: 403, headers: { 'X-Request-ID': 'req-1' } })))
    await expect(getAdminMetrics()).rejects.toMatchObject({ status: 403, requestId: 'req-1', message: 'denied' })
  })
})

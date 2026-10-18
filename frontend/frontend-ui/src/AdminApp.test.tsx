import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AdminApp from './AdminApp'
import * as adminApi from './adminApi'
import { ApiError } from './api'

vi.mock('./adminApi', async () => {
  const actual = await vi.importActual<typeof import('./adminApi')>('./adminApi')
  return { ...actual, getAdminSession: vi.fn(), logoutAdminSession: vi.fn(), getAdminDashboardSummary: vi.fn(), getAdminMetrics: vi.fn(), listAdminBattles: vi.fn(), getAdminExternalCases: vi.fn(), getAdminBattleDetail: vi.fn(), getAdminBattleScore: vi.fn(), getAdminBattleEvents: vi.fn(), getAdminBattleAudit: vi.fn(), getAdminReport: vi.fn(), retryAdminBattle: vi.fn(), cancelAdminBattle: vi.fn(), deleteAdminBattle: vi.fn() }
})

const battle = { id: 'b-1', difficulty: 'high' as const, topic: '测试战局', status: 'failed', createdAt: '2026-10-18T00:00:00Z', attackerOut: { samples: [] }, defenderOut: [] }
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks() })

describe('AdminApp', () => {
  it('shows Cloudflare Access guidance when unauthenticated', async () => {
    vi.mocked(adminApi.getAdminSession).mockResolvedValue({ enabled: true, authenticated: false })
    render(<AdminApp />)
    expect((await screen.findAllByText(/Cloudflare Access/)).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /重新检查/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '退出会话' })).not.toBeInTheDocument()
  })

  it('rechecks the session when the access button is clicked', async () => {
    vi.mocked(adminApi.getAdminSession)
      .mockResolvedValueOnce({ enabled: true, authenticated: false })
      .mockResolvedValueOnce({ enabled: true, authenticated: true })
    vi.mocked(adminApi.getAdminDashboardSummary).mockResolvedValue({ totalBattles: 0 } as never)
    vi.mocked(adminApi.getAdminMetrics).mockResolvedValue({})
    vi.mocked(adminApi.listAdminBattles).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(adminApi.getAdminExternalCases).mockResolvedValue({ available: true, items: [], total: 0, sourceCount: 0 })
    render(<AdminApp />)
    fireEvent.click(await screen.findByRole('button', { name: '我已完成认证，重新检查' }))
    await waitFor(() => expect(adminApi.getAdminSession).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('运行指标')).toBeInTheDocument()
  })

  it('renders authenticated modules and filters battles', async () => {
    vi.mocked(adminApi.getAdminSession).mockResolvedValue({ enabled: true, authenticated: true })
    vi.mocked(adminApi.getAdminDashboardSummary).mockResolvedValue({ totalBattles: 1 } as never)
    vi.mocked(adminApi.getAdminMetrics).mockResolvedValue({ queue: 2 })
    vi.mocked(adminApi.listAdminBattles).mockResolvedValue({ items: [battle], total: 1 })
    vi.mocked(adminApi.getAdminExternalCases).mockResolvedValue({ available: true, items: [], total: 0, sourceCount: 0 })
    render(<AdminApp />)
    expect(await screen.findByText('运行指标')).toBeInTheDocument()
    expect(await screen.findByText('总战局')).toBeInTheDocument()
    expect(screen.queryByText('原始指标数据')).toBeInTheDocument()
    expect(screen.getByText('战局列表')).toBeInTheDocument()
    expect(screen.getByText('外部案例')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '搜索战局' }), { target: { value: 'needle' } })
    await waitFor(() => expect(adminApi.listAdminBattles).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'needle' })))
  })

  it('allows access when browser authentication is disabled', async () => {
    vi.mocked(adminApi.getAdminSession).mockResolvedValue({ enabled: false, authenticated: false })
    vi.mocked(adminApi.getAdminDashboardSummary).mockResolvedValue({ totalBattles: 0 } as never)
    vi.mocked(adminApi.getAdminMetrics).mockResolvedValue({})
    vi.mocked(adminApi.listAdminBattles).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(adminApi.getAdminExternalCases).mockResolvedValue({ available: true, items: [], total: 0, sourceCount: 0 })
    render(<AdminApp />)
    expect(await screen.findByText('运行指标')).toBeInTheDocument()
    expect(screen.queryByText(/Cloudflare Access/)).not.toBeInTheDocument()
  })

  it('confirms and retries failed battles', async () => {
    vi.mocked(adminApi.getAdminSession).mockResolvedValue({ enabled: true, authenticated: true })
    vi.mocked(adminApi.getAdminDashboardSummary).mockResolvedValue({ totalBattles: 1 } as never)
    vi.mocked(adminApi.getAdminMetrics).mockResolvedValue({})
    vi.mocked(adminApi.listAdminBattles).mockResolvedValue({ items: [battle], total: 1 })
    vi.mocked(adminApi.getAdminExternalCases).mockResolvedValue({ available: true, items: [], total: 0, sourceCount: 0 })
    vi.mocked(adminApi.getAdminBattleDetail).mockResolvedValue(battle)
    vi.mocked(adminApi.retryAdminBattle).mockResolvedValue({ ...battle, status: 'pending' })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<AdminApp />)
    fireEvent.click(await screen.findByRole('button', { name: '查看测试战局' }))
    fireEvent.click(await screen.findByRole('button', { name: '重试战局' }))
    await waitFor(() => expect(adminApi.retryAdminBattle).toHaveBeenCalledWith('b-1'))
  })

  it('updates action buttons from the retry response status', async () => {
    vi.mocked(adminApi.getAdminSession).mockResolvedValue({ enabled: true, authenticated: true })
    vi.mocked(adminApi.getAdminDashboardSummary).mockResolvedValue({ totalBattles: 1 } as never)
    vi.mocked(adminApi.getAdminMetrics).mockResolvedValue({})
    vi.mocked(adminApi.listAdminBattles).mockResolvedValue({ items: [battle], total: 1 })
    vi.mocked(adminApi.getAdminExternalCases).mockResolvedValue({ available: true, items: [], total: 0, sourceCount: 0 })
    vi.mocked(adminApi.retryAdminBattle).mockResolvedValue({ ...battle, status: 'pending' })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<AdminApp />)
    fireEvent.click(await screen.findByRole('button', { name: '查看测试战局' }))
    fireEvent.click(await screen.findByRole('button', { name: '重试战局' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: '重试战局' })).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '删除战局' })).not.toBeInTheDocument()
  })

  it('updates action buttons from the cancel response status', async () => {
    const runningBattle = { ...battle, status: 'running' }
    vi.mocked(adminApi.getAdminSession).mockResolvedValue({ enabled: true, authenticated: true })
    vi.mocked(adminApi.getAdminDashboardSummary).mockResolvedValue({ totalBattles: 1 } as never)
    vi.mocked(adminApi.getAdminMetrics).mockResolvedValue({})
    vi.mocked(adminApi.listAdminBattles).mockResolvedValue({ items: [runningBattle], total: 1 })
    vi.mocked(adminApi.getAdminExternalCases).mockResolvedValue({ available: true, items: [], total: 0, sourceCount: 0 })
    vi.mocked(adminApi.cancelAdminBattle).mockResolvedValue({ ...runningBattle, status: 'failed' })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<AdminApp />)
    fireEvent.click(await screen.findByRole('button', { name: '查看测试战局' }))
    fireEvent.click(await screen.findByRole('button', { name: '取消战局' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: '取消战局' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: '删除战局' })).toBeInTheDocument()
  })

  it('clears the browser session before leaving and reports logout failures', async () => {
    vi.mocked(adminApi.getAdminSession).mockResolvedValue({ enabled: true, authenticated: true })
    vi.mocked(adminApi.getAdminDashboardSummary).mockResolvedValue({ totalBattles: 0 } as never)
    vi.mocked(adminApi.getAdminMetrics).mockResolvedValue({})
    vi.mocked(adminApi.listAdminBattles).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(adminApi.getAdminExternalCases).mockResolvedValue({ available: true, items: [], total: 0, sourceCount: 0 })
    vi.mocked(adminApi.logoutAdminSession).mockResolvedValue()
    render(<AdminApp />)
    fireEvent.click(await screen.findByRole('button', { name: '退出会话' }))
    await waitFor(() => expect(adminApi.logoutAdminSession).toHaveBeenCalledTimes(1))
  })

  it('does not reload deleted battle details', async () => {
    vi.mocked(adminApi.getAdminSession).mockResolvedValue({ enabled: true, authenticated: true })
    vi.mocked(adminApi.getAdminDashboardSummary).mockResolvedValue({ totalBattles: 1 } as never)
    vi.mocked(adminApi.getAdminMetrics).mockResolvedValue({})
    vi.mocked(adminApi.listAdminBattles).mockResolvedValue({ items: [battle], total: 1 })
    vi.mocked(adminApi.getAdminExternalCases).mockResolvedValue({ available: true, items: [], total: 0, sourceCount: 0 })
    vi.mocked(adminApi.getAdminBattleDetail).mockResolvedValue(battle)
    vi.mocked(adminApi.getAdminBattleScore).mockResolvedValue({} as never)
    vi.mocked(adminApi.getAdminBattleEvents).mockResolvedValue({ items: [], total: 0, hasMore: false })
    vi.mocked(adminApi.getAdminBattleAudit).mockResolvedValue({})
    vi.mocked(adminApi.getAdminReport).mockResolvedValue({})
    vi.mocked(adminApi.deleteAdminBattle).mockResolvedValue()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<AdminApp />)
    fireEvent.click(await screen.findByRole('button', { name: '查看测试战局' }))
    await screen.findByRole('button', { name: '删除战局' })
    const detailCalls = vi.mocked(adminApi.getAdminBattleDetail).mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: '删除战局' }))
    await waitFor(() => expect(adminApi.deleteAdminBattle).toHaveBeenCalledWith('b-1'))
    expect(adminApi.getAdminBattleDetail).toHaveBeenCalledTimes(detailCalls)
    expect(screen.getByText('选择战局查看详情、评分、事件、审计和报告。')).toBeInTheDocument()
  })

  it('shows the logout request id when session cleanup fails', async () => {
    vi.mocked(adminApi.getAdminSession).mockResolvedValue({ enabled: true, authenticated: true })
    vi.mocked(adminApi.getAdminDashboardSummary).mockResolvedValue({ totalBattles: 0 } as never)
    vi.mocked(adminApi.getAdminMetrics).mockResolvedValue({})
    vi.mocked(adminApi.listAdminBattles).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(adminApi.getAdminExternalCases).mockResolvedValue({ available: true, items: [], total: 0, sourceCount: 0 })
    vi.mocked(adminApi.logoutAdminSession).mockRejectedValue(new ApiError(503, '退出会话失败', 'logout-1'))
    render(<AdminApp />)
    fireEvent.click(await screen.findByRole('button', { name: '退出会话' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('请求 ID：logout-1'))
  })

  it('does not let a late detail response replace the currently selected battle', async () => {
    const otherBattle = { ...battle, id: 'b-2', topic: '当前战局', status: 'completed' }
    let resolveOldEvents!: (page: Awaited<ReturnType<typeof adminApi.getAdminBattleEvents>>) => void
    vi.mocked(adminApi.getAdminBattleEvents).mockImplementation((id) => id === 'b-1'
      ? new Promise((resolve) => { resolveOldEvents = resolve })
      : Promise.resolve({ items: [{ sequence: 1, type: '当前事件' }], total: 1, hasMore: false }))
    vi.mocked(adminApi.getAdminSession).mockResolvedValue({ enabled: true, authenticated: true })
    vi.mocked(adminApi.getAdminDashboardSummary).mockResolvedValue({ totalBattles: 2 } as never)
    vi.mocked(adminApi.getAdminMetrics).mockResolvedValue({})
    vi.mocked(adminApi.listAdminBattles).mockResolvedValue({ items: [battle, otherBattle], total: 2 })
    vi.mocked(adminApi.getAdminExternalCases).mockResolvedValue({ available: true, items: [], total: 0, sourceCount: 0 })
    vi.mocked(adminApi.getAdminBattleDetail).mockImplementation(async (id) => ({ ...battle, id, topic: id === 'b-1' ? '旧战局' : '当前战局' }))
    vi.mocked(adminApi.getAdminBattleScore).mockResolvedValue({} as never)
    vi.mocked(adminApi.getAdminBattleAudit).mockResolvedValue({})
    vi.mocked(adminApi.getAdminReport).mockResolvedValue({})
    render(<AdminApp />)

    fireEvent.click(await screen.findByRole('button', { name: '查看测试战局' }))
    fireEvent.click(screen.getByRole('button', { name: '查看当前战局' }))
    expect((await screen.findAllByText(/当前事件/)).length).toBeGreaterThan(0)
    await act(async () => { resolveOldEvents({ items: [{ sequence: 1, type: '旧战局迟到事件' }], total: 1, hasMore: false }) })

    expect(screen.getAllByText('当前战局').length).toBeGreaterThan(0)
    expect(screen.queryByText(/旧战局迟到事件/)).not.toBeInTheDocument()
  })

  it('refreshes a visible pending battle every 15 seconds, pauses while hidden, and refreshes on return', async () => {
    const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState')
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    vi.mocked(adminApi.getAdminSession).mockResolvedValue({ enabled: true, authenticated: true })
    vi.mocked(adminApi.getAdminDashboardSummary).mockResolvedValue({ totalBattles: 1 } as never)
    vi.mocked(adminApi.getAdminMetrics).mockResolvedValue({})
    vi.mocked(adminApi.listAdminBattles).mockResolvedValue({ items: [{ ...battle, status: 'pending' }], total: 1 })
    vi.mocked(adminApi.getAdminExternalCases).mockResolvedValue({ available: true, items: [], total: 0, sourceCount: 0 })
    vi.mocked(adminApi.getAdminBattleDetail).mockResolvedValue({ ...battle, status: 'pending' })
    vi.mocked(adminApi.getAdminBattleScore).mockResolvedValue({} as never)
    vi.mocked(adminApi.getAdminBattleEvents).mockResolvedValue({ items: [], total: 0, hasMore: false })
    vi.mocked(adminApi.getAdminBattleAudit).mockResolvedValue({})
    vi.mocked(adminApi.getAdminReport).mockResolvedValue({})
    render(<AdminApp />)
    fireEvent.click(await screen.findByRole('button', { name: '查看测试战局' }))
    await waitFor(() => expect(adminApi.getAdminBattleDetail).toHaveBeenCalledTimes(1))
    await act(async () => { vi.advanceTimersByTime(14_999) })
    expect(adminApi.getAdminBattleDetail).toHaveBeenCalledTimes(1)
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(adminApi.getAdminBattleDetail).toHaveBeenCalledTimes(2)

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await act(async () => { vi.advanceTimersByTime(30_000) })
    expect(adminApi.getAdminBattleDetail).toHaveBeenCalledTimes(2)

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(adminApi.getAdminBattleDetail).toHaveBeenCalledTimes(3)
    if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility)
    else Reflect.deleteProperty(document, 'visibilityState')
  })
})

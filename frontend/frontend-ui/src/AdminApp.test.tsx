import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AdminApp from './AdminApp'
import * as adminApi from './adminApi'
import { ApiError } from './api'
import { PRESET_THEMES, THEME_STORAGE_KEY } from './themes'

vi.mock('./adminApi', async () => {
  const actual = await vi.importActual<typeof import('./adminApi')>('./adminApi')
  return { ...actual, getAdminSession: vi.fn(), loginAdminSession: vi.fn(), logoutAdminSession: vi.fn(), getAdminDashboardSummary: vi.fn(), getAdminMetrics: vi.fn(), listAdminBattles: vi.fn(), getAdminExternalCases: vi.fn(), getAdminBattleDetail: vi.fn(), getAdminBattleScore: vi.fn(), getAdminBattleEvents: vi.fn(), getAdminBattleRounds: vi.fn(), getAdminBattleAudit: vi.fn(), getAdminReport: vi.fn(), retryAdminBattle: vi.fn(), cancelAdminBattle: vi.fn(), deleteAdminBattle: vi.fn(), createAdminBattle: vi.fn(), listAdminSamples: vi.fn(), createAdminSample: vi.fn(), updateAdminSample: vi.fn(), deleteAdminSample: vi.fn(), listAdminRules: vi.fn(), createAdminRule: vi.fn(), updateAdminRule: vi.fn(), deleteAdminRule: vi.fn(), listAdminAuditLogs: vi.fn() }
})

const battle = { id: 'b-1', difficulty: 'high' as const, topic: '测试战局', status: 'failed', createdAt: '2026-10-18T00:00:00Z', attackerOut: { samples: [] }, defenderOut: [] }
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); window.localStorage.clear(); window.history.replaceState(null, '', '/admin') })
const openWorkspace = async (name: RegExp) => { const tab = await screen.findByRole('tab', { name }); fireEvent.click(tab) }

describe('AdminApp', () => {
  it('exposes workspace tabs and keeps the selected workspace active', async () => {
    vi.mocked(adminApi.getAdminSession).mockResolvedValue({ enabled: true, authenticated: true })
    vi.mocked(adminApi.getAdminDashboardSummary).mockResolvedValue({ totalBattles: 0 } as never)
    vi.mocked(adminApi.getAdminMetrics).mockResolvedValue({})
    vi.mocked(adminApi.listAdminBattles).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(adminApi.getAdminExternalCases).mockResolvedValue({ available: true, items: [], total: 0, sourceCount: 0 })
    render(<AdminApp />)

    const overviewTab = await screen.findByRole('tab', { name: /^总览/ })
    const battlesTab = screen.getByRole('tab', { name: /^战局/ })
    expect(overviewTab).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(battlesTab)
    expect(battlesTab).toHaveAttribute('aria-selected', 'true')
    expect(overviewTab).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tabpanel', { name: '战局工作区' })).toBeInTheDocument()
  })

  it('lets an administrator choose the number of rounds and submits it to the admin API', async () => {
    vi.mocked(adminApi.getAdminSession).mockResolvedValue({ enabled: true, authenticated: true })
    vi.mocked(adminApi.getAdminDashboardSummary).mockResolvedValue({ totalBattles: 0 } as never)
    vi.mocked(adminApi.getAdminMetrics).mockResolvedValue({})
    vi.mocked(adminApi.listAdminBattles).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(adminApi.getAdminExternalCases).mockResolvedValue({ available: true, items: [], total: 0, sourceCount: 0 })
    vi.mocked(adminApi.createAdminBattle).mockResolvedValue({ ...battle, status: 'pending', rounds: 5 } as never)
    render(<AdminApp />)
    await screen.findByRole('tab', { name: /^总览/ })
    fireEvent.click(screen.getByRole('tab', { name: /^管理/ }))
    fireEvent.click(screen.getByRole('tab', { name: '创建战局' }))
    fireEvent.change(screen.getByLabelText('演练回合数'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: '创建并启动战局' }))
    await waitFor(() => expect(adminApi.createAdminBattle).toHaveBeenCalledWith({ topic: PRESET_THEMES[0], difficulty: 'mid', rounds: 5 }))
  })

  it('switches workspaces as real views and persists the selected view in the URL', async () => {
    vi.mocked(adminApi.getAdminSession).mockResolvedValue({ enabled: true, authenticated: true })
    vi.mocked(adminApi.getAdminDashboardSummary).mockResolvedValue({ totalBattles: 0 } as never)
    vi.mocked(adminApi.getAdminMetrics).mockResolvedValue({})
    vi.mocked(adminApi.listAdminBattles).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(adminApi.getAdminExternalCases).mockResolvedValue({ available: true, items: [], total: 0, sourceCount: 0 })
    render(<AdminApp />)
    await screen.findByRole('tab', { name: /^总览/ })
    const monitoringTab = screen.getByRole('tab', { name: /^监控/ })
    fireEvent.click(monitoringTab)
    expect(monitoringTab).toHaveAttribute('aria-selected', 'true')
    expect(window.location.hash).toBe('#monitoring')
    expect(screen.getByRole('tabpanel', { name: '监控工作区' })).toBeInTheDocument()
    expect(screen.queryByRole('tabpanel', { name: '总览工作区' })).not.toBeInTheDocument()
  })

  it('uses the frontend preset theme library and shares custom themes through localStorage', async () => {
    vi.mocked(adminApi.getAdminSession).mockResolvedValue({ enabled: true, authenticated: true })
    vi.mocked(adminApi.getAdminDashboardSummary).mockResolvedValue({ totalBattles: 0 } as never)
    vi.mocked(adminApi.getAdminMetrics).mockResolvedValue({})
    vi.mocked(adminApi.listAdminBattles).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(adminApi.getAdminExternalCases).mockResolvedValue({ available: true, items: [], total: 0, sourceCount: 0 })
    vi.mocked(adminApi.createAdminBattle).mockResolvedValue({ ...battle, status: 'pending' } as never)
    render(<AdminApp />)
    await screen.findByRole('tab', { name: /^总览/ })

    // 主题库不再单独占一个 Tab，而是收进创建战局流程
    fireEvent.click(screen.getByRole('tab', { name: /^管理/ }))
    expect(screen.queryByRole('tab', { name: '主题库' })).not.toBeInTheDocument()
    const themeLibrary = screen.getByRole('group', { name: '主题库' })
    expect(themeLibrary).not.toHaveAttribute('open')
    fireEvent.click(within(themeLibrary).getByText('主题库'))

    // 预置主题与前台一致，六个都在主题库里
    for (const theme of PRESET_THEMES) {
      expect(await within(themeLibrary).findByRole('button', { name: theme })).toBeInTheDocument()
    }

    // 新增自定义主题后写入前台同名 localStorage 键
    const custom = '内部知识库越权检索'
    fireEvent.change(within(themeLibrary).getByLabelText('新增主题'), { target: { value: custom } })
    fireEvent.click(within(themeLibrary).getByRole('button', { name: '添加到主题库' }))
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(THEME_STORAGE_KEY) ?? '[]')).toContain(custom))

    // 自定义主题可直接带入创建战局并提交
    fireEvent.click(await within(themeLibrary).findByRole('button', { name: custom }))
    fireEvent.click(screen.getByRole('button', { name: '创建并启动战局' }))
    await waitFor(() => expect(adminApi.createAdminBattle).toHaveBeenCalledWith({ topic: custom, difficulty: 'mid', rounds: 3 }))
  })

  it('shows password authentication when unauthenticated', async () => {
    vi.mocked(adminApi.getAdminSession).mockResolvedValue({ enabled: true, authenticated: false })
    render(<AdminApp />)
    expect(await screen.findByRole('heading', { name: '管理员后台 - 管理员认证' })).toBeInTheDocument()
    expect(screen.getByText('使用后台管理密码建立安全会话。')).toBeInTheDocument()
    expect(screen.getByLabelText('后台管理密码')).toHaveAttribute('type', 'password')
    expect(screen.getByRole('img', { name: '全息网络拓扑' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '安全登录' })).toBeInTheDocument()
    expect(document.querySelector('.holo-server')).toBeInTheDocument()
    expect(document.querySelector('.holo-key')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重新检查/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '退出会话' })).not.toBeInTheDocument()
  })

  it('logs in with the administrator password and shows the workspace', async () => {
    vi.mocked(adminApi.getAdminSession)
      .mockResolvedValueOnce({ enabled: true, authenticated: false })
      .mockResolvedValueOnce({ enabled: true, authenticated: true })
    vi.mocked(adminApi.loginAdminSession).mockResolvedValue()
    vi.mocked(adminApi.getAdminDashboardSummary).mockResolvedValue({ totalBattles: 0 } as never)
    vi.mocked(adminApi.getAdminMetrics).mockResolvedValue({})
    vi.mocked(adminApi.listAdminBattles).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(adminApi.getAdminExternalCases).mockResolvedValue({ available: true, items: [], total: 0, sourceCount: 0 })
    render(<AdminApp />)
    fireEvent.change(await screen.findByLabelText('后台管理密码'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: '登录管理后台' }))
    await waitFor(() => expect(adminApi.loginAdminSession).toHaveBeenCalledWith('secret'))
    expect(await screen.findByRole('tab', { name: /^总览/ })).toBeInTheDocument()
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
    expect(await screen.findByRole('tab', { name: /^总览/ })).toBeInTheDocument()
  })

  it('renders authenticated modules and filters battles', async () => {
    vi.mocked(adminApi.getAdminSession).mockResolvedValue({ enabled: true, authenticated: true })
    vi.mocked(adminApi.getAdminDashboardSummary).mockResolvedValue({ totalBattles: 1 } as never)
    vi.mocked(adminApi.getAdminMetrics).mockResolvedValue({ service: '智能体攻防实验室', uptimeSeconds: 90, requests: 12 })
    vi.mocked(adminApi.listAdminBattles).mockResolvedValue({ items: [battle], total: 1 })
    vi.mocked(adminApi.getAdminExternalCases).mockResolvedValue({ available: true, items: [], total: 0, sourceCount: 0 })
    render(<AdminApp />)
    expect(await screen.findByRole('tab', { name: /^总览/ })).toBeInTheDocument()
    expect((await screen.findAllByText('总战局')).length).toBeGreaterThan(0)
    // 指标区只展示中文卡片与格式化后的数值，不再输出原始 JSON
    expect(screen.queryByText('原始指标数据')).not.toBeInTheDocument()
    await openWorkspace(/^监控/)
    expect(screen.getByText('1 分 30 秒')).toBeInTheDocument()

    await openWorkspace(/^战局/)
    expect(screen.getByText('战局列表')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '搜索战局' }), { target: { value: 'needle' } })
    await waitFor(() => expect(adminApi.listAdminBattles).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'needle' })))

    fireEvent.click(screen.getByRole('tab', { name: /^监控/ }))
    expect(screen.getByText('外部案例')).toBeInTheDocument()
    const externalCases = screen.getByRole('group', { name: '外部案例' })
    expect(externalCases).not.toHaveAttribute('open')
    fireEvent.click(within(externalCases).getByRole('heading', { name: '外部案例' }))
    expect(within(externalCases).getByRole('textbox', { name: '搜索外部案例' })).toBeVisible()
  })

  it('manages samples from the sample library tab with a modal editor', async () => {
    vi.mocked(adminApi.getAdminSession).mockResolvedValue({ enabled: true, authenticated: true })
    vi.mocked(adminApi.getAdminDashboardSummary).mockResolvedValue({ totalBattles: 0 } as never)
    vi.mocked(adminApi.getAdminMetrics).mockResolvedValue({})
    vi.mocked(adminApi.listAdminBattles).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(adminApi.getAdminExternalCases).mockResolvedValue({ available: true, items: [], total: 0, sourceCount: 0 })
    vi.mocked(adminApi.listAdminSamples).mockResolvedValue({ items: [{ id: 's-1', topic: '提示注入', content: '忽略规则', source: '测试', useCount: 2, createdAt: '', updatedAt: '' }], total: 1 })
    vi.mocked(adminApi.createAdminSample).mockResolvedValue({ id: 's-2', topic: '越狱', content: '新样本', source: '管理员', useCount: 0, createdAt: '', updatedAt: '' })
    render(<AdminApp />)
    await screen.findByRole('tab', { name: /^总览/ })
    fireEvent.click(screen.getByRole('tab', { name: /^管理/ }))
    fireEvent.click(screen.getByRole('tab', { name: '样本库' }))
    expect(await screen.findByText('提示注入')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '新增样本' }))
    expect(screen.getByRole('dialog', { name: '新增样本' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('样本主题'), { target: { value: '越狱' } })
    fireEvent.change(screen.getByLabelText('样本内容'), { target: { value: '新样本' } })
    fireEvent.change(screen.getByLabelText('样本来源'), { target: { value: '管理员' } })
    fireEvent.click(screen.getByRole('button', { name: '保存样本' }))
    await waitFor(() => expect(adminApi.createAdminSample).toHaveBeenCalledWith({ topic: '越狱', content: '新样本', source: '管理员' }))
  })

  it('searches rules and exposes audit log tab', async () => {
    vi.mocked(adminApi.getAdminSession).mockResolvedValue({ enabled: true, authenticated: true })
    vi.mocked(adminApi.getAdminDashboardSummary).mockResolvedValue({ totalBattles: 0 } as never)
    vi.mocked(adminApi.getAdminMetrics).mockResolvedValue({})
    vi.mocked(adminApi.listAdminBattles).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(adminApi.getAdminExternalCases).mockResolvedValue({ available: true, items: [], total: 0, sourceCount: 0 })
    vi.mocked(adminApi.listAdminRules).mockResolvedValue({ items: [{ id: 'r-1', name: '越权拦截', condition: 'role != admin', action: '拦截', hitCount: 1, createdAt: '', updatedAt: '' }], total: 1 })
    vi.mocked(adminApi.listAdminAuditLogs).mockResolvedValue([{ id: 'a-1', eventType: 'rule.updated', status: 'success', createdAt: '2026-01-01', data: {} }])
    render(<AdminApp />)
    await screen.findByRole('tab', { name: /^总览/ })
    fireEvent.click(screen.getByRole('tab', { name: /^管理/ }))
    fireEvent.click(screen.getByRole('tab', { name: '规则库' }))
    expect(await screen.findByText('越权拦截')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '搜索规则' }), { target: { value: '越权' } })
    fireEvent.click(screen.getByRole('button', { name: '查询规则' }))
    await waitFor(() => expect(adminApi.listAdminRules).toHaveBeenLastCalledWith('越权'))
    fireEvent.click(screen.getByRole('tab', { name: /^管理/ }))
    fireEvent.click(screen.getByRole('tab', { name: '审计日志' }))
    expect(await screen.findByText('rule.updated')).toBeInTheDocument()
  })

  it('allows access when browser authentication is disabled', async () => {
    vi.mocked(adminApi.getAdminSession).mockResolvedValue({ enabled: false, authenticated: false })
    vi.mocked(adminApi.getAdminDashboardSummary).mockResolvedValue({ totalBattles: 0 } as never)
    vi.mocked(adminApi.getAdminMetrics).mockResolvedValue({})
    vi.mocked(adminApi.listAdminBattles).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(adminApi.getAdminExternalCases).mockResolvedValue({ available: true, items: [], total: 0, sourceCount: 0 })
    render(<AdminApp />)
    expect(await screen.findByRole('tab', { name: /^总览/ })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '管理员后台 - 管理员认证' })).not.toBeInTheDocument()
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
    await openWorkspace(/^战局/)
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
    await openWorkspace(/^战局/)
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
    await openWorkspace(/^战局/)
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
    await openWorkspace(/^战局/)
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

    await openWorkspace(/^战局/)
    fireEvent.click(await screen.findByRole('button', { name: '查看测试战局' }))
    fireEvent.click(screen.getByRole('button', { name: '查看当前战局' }))
    expect((await screen.findAllByText(/当前事件/)).length).toBeGreaterThan(0)
    await act(async () => { resolveOldEvents({ items: [{ sequence: 1, type: '旧战局迟到事件' }], total: 1, hasMore: false }) })

    expect(screen.getAllByText('当前战局').length).toBeGreaterThan(0)
    expect(screen.queryByText(/旧战局迟到事件/)).not.toBeInTheDocument()
  })

  it('does not request the same next event page twice while it is loading', async () => {
    let resolveNextPage!: (page: Awaited<ReturnType<typeof adminApi.getAdminBattleEvents>>) => void
    vi.mocked(adminApi.getAdminBattleEvents)
      .mockResolvedValueOnce({ items: [{ sequence: 1, type: '首条事件' }], total: 2, hasMore: true })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNextPage = resolve }))
    vi.mocked(adminApi.getAdminSession).mockResolvedValue({ enabled: true, authenticated: true })
    vi.mocked(adminApi.getAdminDashboardSummary).mockResolvedValue({ totalBattles: 1 } as never)
    vi.mocked(adminApi.getAdminMetrics).mockResolvedValue({})
    vi.mocked(adminApi.listAdminBattles).mockResolvedValue({ items: [battle], total: 1 })
    vi.mocked(adminApi.getAdminExternalCases).mockResolvedValue({ available: true, items: [], total: 0, sourceCount: 0 })
    vi.mocked(adminApi.getAdminBattleDetail).mockResolvedValue(battle)
    vi.mocked(adminApi.getAdminBattleScore).mockResolvedValue({} as never)
    vi.mocked(adminApi.getAdminBattleAudit).mockResolvedValue({})
    vi.mocked(adminApi.getAdminReport).mockResolvedValue({})
    render(<AdminApp />)
    await openWorkspace(/^战局/)
    fireEvent.click(await screen.findByRole('button', { name: '查看测试战局' }))

    const replay = await screen.findByRole('region', { name: /战局记录/ })
    const loadMore = await within(replay).findByRole('button', { name: '加载更多事件（1 / 2）' })
    fireEvent.click(loadMore)
    fireEvent.click(loadMore)

    await waitFor(() => expect(adminApi.getAdminBattleEvents).toHaveBeenCalledTimes(2))
    await act(async () => { resolveNextPage({ items: [{ sequence: 2, type: '下一条事件' }], total: 2, hasMore: false }) })
    await waitFor(() => expect(screen.queryByRole('button', { name: /加载更多事件/ })).not.toBeInTheDocument())
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
    await openWorkspace(/^战局/)
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

  const readableBattle = { ...battle, id: 'b-9', topic: '可读战局', status: 'completed' as const, rounds: 2 }
  const readableEvents = [
    { sequence: 1, type: 'round.completed', timestamp: '2026-10-18T00:00:01Z', data: { round: 1, caught: [{ ruleId: 'LAB-SQLI-001' }], risks: [], fixed: [] } },
    { sequence: 2, type: 'attack.compromised', timestamp: '2026-10-18T00:00:02Z', data: { round: 2, targetVerified: true, simulated: true } },
  ]
  const readableRounds = {
    total: 2, requestedRounds: 3,
    rounds: [
      { round: 1, status: 'completed', sample: { type: '提示注入', severity: 'high' }, caught: [{ ruleId: 'LAB-SQLI-001' }], risks: [], fixed: [], durationMs: 1500, arbiterReview: { verdict: 'undetermined', needsHumanReview: true, agentSource: 'arbiter-rule-fallback', rationale: '无验证证据，需人工复核' } },
      { round: 2, status: 'completed', sample: { type: 'SQL 注入', severity: 'medium' }, caught: [], risks: [], fixed: [], durationMs: 800, compromised: { targetVerified: true, simulated: true }, arbiterReview: { verdict: 'defender_won', needsHumanReview: false, agentSource: 'arbiter-llm' } },
    ],
    stats: { attackGenerated: 2, defenderDetected: 1, fixesSuggested: 0, strategyChecks: 2 },
  }

  function mockReadableBattle(battleOverrides: Record<string, unknown>) {
    vi.mocked(adminApi.getAdminSession).mockResolvedValue({ enabled: true, authenticated: true })
    vi.mocked(adminApi.getAdminDashboardSummary).mockResolvedValue({ totalBattles: 1 } as never)
    vi.mocked(adminApi.getAdminMetrics).mockResolvedValue({})
    vi.mocked(adminApi.listAdminBattles).mockResolvedValue({ items: [{ ...readableBattle, ...battleOverrides } as never], total: 1 })
    vi.mocked(adminApi.getAdminExternalCases).mockResolvedValue({ available: true, items: [], total: 0, sourceCount: 0 })
    vi.mocked(adminApi.getAdminBattleDetail).mockResolvedValue({ ...readableBattle, ...battleOverrides } as never)
    vi.mocked(adminApi.getAdminBattleScore).mockResolvedValue({ version: 'frontend-v1', status: 'ok', attacker: { status: 'ok', score: null, maxScore: 100, categories: [] }, defender: { status: 'ok', score: null, maxScore: 100, categories: [] } } as never)
    vi.mocked(adminApi.getAdminBattleEvents).mockResolvedValue({ items: readableEvents as never, total: 2, hasMore: false })
    vi.mocked(adminApi.getAdminBattleAudit).mockResolvedValue({ valid: false, issueCount: 1, eventCount: 2, issues: [{ code: 'duplicate_event_id', message: '事件 ID 重复' }] })
    vi.mocked(adminApi.getAdminReport).mockResolvedValue({})
    vi.mocked(adminApi.getAdminBattleRounds).mockResolvedValue(readableRounds as never)
  }

  it('renders a readable verdict and round breakdown before any raw JSON', async () => {
    mockReadableBattle({ verdict: 'undetermined' })
    render(<AdminApp />)
    await openWorkspace(/^战局/)
    fireEvent.click(await screen.findByRole('button', { name: '查看可读战局' }))

    expect(await screen.findByText('战局结论')).toBeInTheDocument()
    expect(screen.getAllByText('结果未判定').length).toBeGreaterThan(0)
    expect(screen.getByText(/未取得验证证据/)).toBeInTheDocument()
    expect(screen.getByText('回合明细（2 轮）')).toBeInTheDocument()
    expect(screen.getByText('请求 3 轮，实际产出 2 轮')).toBeInTheDocument()
    expect(screen.getAllByText('已拦截').length).toBeGreaterThan(0)
    expect(screen.getAllByText('穿透（模拟验证）').length).toBeGreaterThan(0)
    expect(screen.getAllByText('证据不足').length).toBeGreaterThan(0)
    expect(screen.getAllByText('事件 ID 重复').length).toBeGreaterThan(0)
    expect(screen.getByText('结果未判定 · 需复核')).toBeInTheDocument()
    expect(screen.getByText('防守成功')).toBeInTheDocument()
    expect(screen.getByText(/独立裁决由 arbiter 单独复核/)).toBeInTheDocument()
    expect(screen.queryByText('原始数据（排查用）')).not.toBeInTheDocument()
  })

  it('renders the raw data disclosure only with the debug query flag', async () => {
    mockReadableBattle({ verdict: 'undetermined' })
    const originalUrl = `${window.location.pathname}${window.location.search}`
    window.history.replaceState({}, '', '/admin?debug=1')
    try {
      render(<AdminApp />)
      await openWorkspace(/^战局/)
      fireEvent.click(await screen.findByRole('button', { name: '查看可读战局' }))

      const rawData = await screen.findByText('原始数据（排查用）')
      expect(rawData.closest('details')).not.toHaveAttribute('open')
    } finally {
      window.history.replaceState({}, '', originalUrl)
    }
  })

  it('reports a verified compromise instead of an undetermined result', async () => {
    mockReadableBattle({ verdict: 'attacker_won' })
    render(<AdminApp />)
    await openWorkspace(/^战局/)
    fireEvent.click(await screen.findByRole('button', { name: '查看可读战局' }))
    expect((await screen.findAllByText('攻击得手（目标已验证）')).length).toBeGreaterThan(0)
    expect(screen.queryByText(/未取得验证证据/)).not.toBeInTheDocument()
  })

  it('puts headline KPIs (with rates) above the fold and never prints raw English metric keys', async () => {
    vi.mocked(adminApi.getAdminSession).mockResolvedValue({ enabled: true, authenticated: true })
    vi.mocked(adminApi.getAdminDashboardSummary).mockResolvedValue({
      totalBattles: 30, completedBattles: 18, failedBattles: 12, highDifficultyBattles: 14, events: 275,
      sampleCount: 48, defenderDetected: 56, fixesSuggested: 56, riskCount: 56, recommendationCount: 56,
      acpCallBattles: 18, agentExecutionCount: 28, acpSuccessCount: 22, acpFailureCount: 6,
      averageAgentCallLatencyMs: 1716, ruleLibraryCaseCount: 3,
    } as never)
    vi.mocked(adminApi.getAdminMetrics).mockResolvedValue({ averageLatencyMs: 41.59, auditEvents: 3075 })
    vi.mocked(adminApi.listAdminBattles).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(adminApi.getAdminExternalCases).mockResolvedValue({ available: true, items: [], total: 0, sourceCount: 0 })
    render(<AdminApp />)
    await screen.findByRole('tab', { name: /^总览/ })

    const kpi = screen.getByRole('region', { name: '关键指标' })
    expect(await within(kpi).findByText('60%')).toBeInTheDocument() // 18/30
    expect(within(kpi).getByText('40%')).toBeInTheDocument() // 12/30
    expect(within(kpi).getByText('1.72 秒')).toBeInTheDocument() // 1716ms 智能体平均响应

    // 英文原始键已全部配中文名，兜底分组不该出现
    expect(screen.queryByText('未登记指标')).not.toBeInTheDocument()
    for (const key of ['sampleCount', 'acpCallBattles', 'agentExecutionCount', 'averageAgentCallLatencyMs', 'ruleLibraryCaseCount']) {
      expect(screen.queryByText(key)).not.toBeInTheDocument()
    }
    await openWorkspace(/^监控/)
    // 监控首屏只保留服务健康；其余指标默认收起，但仍可展开查看
    const moreMetrics = screen.getByRole('group', { name: '更多运行数据' })
    expect(moreMetrics).not.toHaveAttribute('open')
    expect(within(moreMetrics).getByText('防守命中（含建议/风险）')).not.toBeVisible()
    fireEvent.click(within(moreMetrics).getByText('更多运行数据'))
    expect(within(moreMetrics).getByText('防守命中（含建议/风险）')).toBeVisible()
  })

  it('renders audit log data as labelled key/value chips instead of raw JSON', async () => {
    vi.mocked(adminApi.getAdminSession).mockResolvedValue({ enabled: true, authenticated: true })
    vi.mocked(adminApi.getAdminDashboardSummary).mockResolvedValue({ totalBattles: 0 } as never)
    vi.mocked(adminApi.getAdminMetrics).mockResolvedValue({})
    vi.mocked(adminApi.listAdminBattles).mockResolvedValue({ items: [], total: 0 })
    vi.mocked(adminApi.getAdminExternalCases).mockResolvedValue({ available: true, items: [], total: 0, sourceCount: 0 })
    vi.mocked(adminApi.listAdminAuditLogs).mockResolvedValue([
      { id: 'a-1', createdAt: '2026-10-24T10:00:00Z', actorRole: 'admin', eventType: 'battle.created', status: 'ok', data: { battleId: 'b-1', topic: '提示注入', rounds: 3 } },
    ] as never)
    render(<AdminApp />)
    await screen.findByRole('tab', { name: /^总览/ })
    fireEvent.click(screen.getByRole('tab', { name: /^管理/ }))
    fireEvent.click(screen.getByRole('tab', { name: '审计日志' }))

    expect(await screen.findByText('战局 ID')).toBeInTheDocument()
    expect(screen.getByText('战局创建')).toBeInTheDocument() // eventType 走中文映射
    expect(screen.queryByText(/"battleId":/)).not.toBeInTheDocument()
  })
})

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const battle = {
  id: 'battle-test',
  difficulty: 'low' as const,
  topic: '已有战局',
  status: 'completed',
  createdAt: '2026-10-07T00:00:00Z',
  attackerOut: { agentSource: 'acp-llm', samples: [{ type: 'defect', topic: '已有战局', severity: 'low', content: 'sample', simulation: true }] },
  defenderOut: [{ agentSource: 'acp-rule-fallback', caught: [], risks: [], fixed: [] }],
}

function installFetchMock(totalBattles = 21, source = 'acp-llm', defenseSource = 'acp-rule-fallback', initialSession = { enabled: false, authenticated: false }) {
  let session = initialSession
  let sessionChecks = 0
  const sourceBattle = {
    ...battle,
    attackerOut: { ...battle.attackerOut, agentSource: source },
    defenderOut: [{ ...battle.defenderOut[0], agentSource: defenseSource }],
  }
  let createdBattle: typeof sourceBattle | null = null
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/auth/session')) {
      if (!init?.method && session.enabled && !session.authenticated && sessionChecks++ > 0) {
        session = { enabled: true, authenticated: true }
      }
      return Promise.resolve(new Response(JSON.stringify(session), { status: 200 }))
    }
    if (url.pathname.endsWith('/health')) return Promise.resolve(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
    if (url.pathname.endsWith('/external-cases')) {
      const query = url.searchParams.get('q') ?? ''
      const item = {
        externalId: 'CVE-2099-0001',
        vendorProject: 'Example Vendor',
        product: 'Example Gateway',
        title: '公开案例',
        dateAdded: '2026-10-11',
        description: '公开来源中的案例描述',
        requiredAction: 'Apply the fix',
        cwes: ['CWE-89'],
        sourceUrl: 'https://example.invalid/advisory',
        provenanceStatus: 'verified_primary',
        synthetic: false,
        recordKind: 'external_fact',
        source: { publisher: 'CISA', sourceType: 'known_exploited_vulnerabilities', catalogVersion: 'test-1', retrievedAt: '2026-10-11T00:00:00Z', contentSha256: 'a'.repeat(64) },
      }
      return Promise.resolve(new Response(JSON.stringify({ available: !query || query.includes('CVE'), items: !query || query.includes('CVE') ? [item] : [], total: !query || query.includes('CVE') ? 1 : 0, sourceCount: 1 }), { status: 200 }))
    }
    if (url.pathname.endsWith('/dashboard/summary')) {
      return Promise.resolve(new Response(JSON.stringify({
        totalBattles,
        completedBattles: totalBattles,
        failedBattles: 0,
        highDifficultyBattles: 0,
        sampleCount: 2,
        ruleHitCount: 1,
        riskCount: 2,
        recommendationCount: 1,
        simulationSampleCount: 2,
        acpCallBattles: 1,
        ruleLibraryCaseCount: 3,
      }), { status: 200 }))
    }
    if (url.pathname.endsWith('/battles') && init?.method === 'POST') {
      createdBattle = { ...sourceBattle, id: 'battle-new', topic: '新战局' }
      return Promise.resolve(new Response(JSON.stringify(createdBattle), { status: 201 }))
    }
    if (url.pathname.endsWith('/battles') && init?.method !== 'POST') {
      const query = url.searchParams.get('q')?.toLowerCase() ?? ''
      const matching = Array.from({ length: totalBattles }, (_, index) => index)
        .filter((index) => !query || `历史战局 ${index + 1}`.toLowerCase().includes(query) || `battle-${index + 1}`.includes(query))
      const offset = Number(url.searchParams.get('offset') ?? '0')
      const limit = Number(url.searchParams.get('limit') ?? '10')
      const items = matching.slice(offset, offset + limit).map((index) => index === 0 ? sourceBattle : {
        ...sourceBattle,
        id: `battle-${index + 1}`,
        topic: `历史战局 ${index + 1}`,
      })
      return Promise.resolve(new Response(JSON.stringify(items), {
        status: 200,
        headers: { 'X-Total-Count': String(matching.length) },
      }))
    }
    if (url.pathname.includes('/battles/')) {
      const parts = url.pathname.split('/').filter(Boolean)
      const battlesIndex = parts.indexOf('battles')
      const id = decodeURIComponent(parts[battlesIndex + 1] ?? '')
      const action = parts[battlesIndex + 2]
      if (action === 'score') {
        return Promise.resolve(new Response(JSON.stringify({
          version: 'internal-agent-v2',
          status: 'scored',
          message: '分别衡量攻击/防守输出完整度与可审计性',
          attacker: { status: 'scored', score: 65, maxScore: 100, categories: [{ label: '样本结构完整度', score: 20, maxScore: 35 }] },
          defender: { status: 'scored', score: 80, maxScore: 100, categories: [{ label: '逐轮响应完整度', score: 25, maxScore: 25 }] },
        }), { status: 200 }))
      }
      if (action === 'retry' && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ ...sourceBattle, id, status: 'pending', topic: '已重试战局' }), { status: 202 }))
      }
      if (init?.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (createdBattle?.id === id) {
        return Promise.resolve(new Response(JSON.stringify(createdBattle), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify(id === battle.id ? sourceBattle : { ...sourceBattle, id, topic: '已恢复回放' }), { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', '/')
})

describe('App', () => {
  it('states that creating a battle persists a battle record and analyzes synthetic samples', async () => {
    installFetchMock()
    render(<App />)

    expect(await screen.findByText('战局会真实写入后端并同步到后台；当前分析对象为合成安全样本，不会向外部目标发起请求。')).toBeInTheDocument()
    expect(screen.queryByText(/实时战局/)).not.toBeInTheDocument()
    expect(screen.queryByText(/测试/)).not.toBeInTheDocument()
  })

  it('distinguishes persisted backend battles from synthetic sample evaluation', async () => {
    installFetchMock()
    render(<App />)

    expect(await screen.findByText('战局会真实写入后端并同步到后台；当前分析对象为合成安全样本，不会向外部目标发起请求。')).toBeInTheDocument()
    expect(screen.getByText('合成安全样本 · 未向外部目标发起请求')).toBeInTheDocument()
    expect(screen.getByText('本场处理的是合成安全样本；没有向真实目标发起请求。')).toBeInTheDocument()
    expect(screen.queryByText(/持久化的模拟|测试/)).not.toBeInTheDocument()
  })

  it('lets users refresh the live health check while the service is healthy', async () => {
    const fetchMock = installFetchMock()
    render(<App />)

    const status = await screen.findByRole('button', { name: /服务运行正常.*点击刷新检查/ })
    await waitFor(() => expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/health'))).toHaveLength(1))
    fireEvent.click(status)

    await waitFor(() => expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/health'))).toHaveLength(2))
  })

  it('links the public header to the administrator backend', async () => {
    installFetchMock()
    render(<App />)

    const adminLink = await screen.findByRole('link', { name: '管理员后台' })
    expect(adminLink).toHaveAttribute('href', '/admin')
  })

  it('visually prioritizes saved-battle history over secondary statistics and external references', async () => {
    installFetchMock()
    render(<App />)

    await screen.findByRole('heading', { name: '开始新战局（New battle）' })
    const primaryLayout = screen.getByRole('heading', { name: '历史战局（Battle history）' }).closest('.layout')!
    const stats = screen.getByRole('region', { name: '真实统计口径（Persisted statistics）' })
    const external = screen.getByRole('group', { name: '外部安全案例库（External case references）' })

    expect(primaryLayout.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(primaryLayout.compareDocumentPosition(external) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('omits pagination controls when the saved-battle history is empty', async () => {
    installFetchMock(0)
    render(<App />)

    expect(await screen.findByText('暂无匹配记录（No matching battles）')).toBeInTheDocument()
    expect(screen.queryByText('第 1 / 1 页 · 每页 10 场')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
  })

  it('loads independently sourced statistics and validates an empty topic', async () => {
    const fetchMock = installFetchMock()
    render(<App />)

    expect(await screen.findByRole('heading', { name: '已有战局', level: 2 })).toBeInTheDocument()
    const stats = screen.getByRole('region', { name: '真实统计口径（Persisted statistics）' })
    expect(stats).toHaveTextContent('21')
    expect(stats).toHaveTextContent('3')
    expect(stats).toHaveTextContent('2')
    expect(stats).toHaveTextContent('1')
    expect(await screen.findByText(/ACP 调用场次：1/)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/dashboard/summary'), expect.anything())

    expect(screen.getByText('缺陷（Defect） · 低（Low）')).toBeInTheDocument()
    expect(screen.getByText('攻击来源：独立 Agent（模型生成）')).toBeInTheDocument()
    expect(screen.getByText('防守来源：独立 Agent（规则兜底）')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /已有战局/ }))
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('battle_id')).toBe('battle-test'))
    fireEvent.change(screen.getByRole('textbox', { name: /^攻防主题/ }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /开始攻防/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('请输入攻防主题')
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/battles'), expect.objectContaining({ method: 'POST' }))
  })

  it('renders external case provenance and supports a read-only search', async () => {
    const fetchMock = installFetchMock()
    render(<App />)

    expect(await screen.findByRole('heading', { name: '外部安全案例库（External references）' })).toBeInTheDocument()
    const cases = screen.getByRole('group', { name: '外部安全案例库（External case references）' })
    expect(cases).not.toHaveAttribute('open')
    expect(within(cases).queryByText('CVE-2099-0001')).not.toBeVisible()
    fireEvent.click(within(cases).getByRole('heading', { name: '外部安全案例库（External references）' }))
    expect(await within(cases).findByText('CVE-2099-0001')).toBeVisible()
    expect(within(cases).getByText(/verified_primary · external_fact/)).toBeInTheDocument()
    fireEvent.change(within(cases).getByRole('textbox', { name: '搜索外部案例' }), { target: { value: 'CVE-2099' } })
    fireEvent.click(within(cases).getByRole('button', { name: '查询' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/external-cases?q=CVE-2099'), expect.anything()))
  })

  it('prefills topic and difficulty from URL parameters', async () => {
    window.history.replaceState({}, '', '/?topic=%E8%AE%A2%E5%8D%95%E6%9F%A5%E8%AF%A2%E6%9D%83%E9%99%90%E6%A0%A1%E9%AA%8C&difficulty=high')
    installFetchMock()
    const view = render(<App />)

    expect(await screen.findByRole('textbox', { name: /^攻防主题/ })).toHaveValue('订单查询权限校验')
    expect(view.container.querySelector<HTMLInputElement>('input[name="difficulty"]:checked')?.parentElement?.textContent).toContain('高（High）')
  })

  it('keeps the existing defaults when URL parameters are absent', async () => {
    installFetchMock()
    const view = render(<App />)

    expect(await screen.findByRole('textbox', { name: /^攻防主题/ })).toHaveValue('提示注入与输入校验')
    expect(view.container.querySelector<HTMLInputElement>('input[name="difficulty"]:checked')?.parentElement?.textContent).toContain('中（Medium）')
  })

  it('restores a battle directly from a replay URL after a page reload', async () => {
    window.history.replaceState({}, '', '/?battle_id=battle-test')
    const fetchMock = installFetchMock()
    const view = render(<App />)

    expect(await screen.findByRole('heading', { name: '已有战局', level: 2 })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/battles/battle-test'), expect.anything())
    view.unmount()
    render(<App />)
    expect(await screen.findByRole('heading', { name: '已有战局', level: 2 })).toBeInTheDocument()
  })

  it('paginates all 50 saved battles without dropping records', async () => {
    const fetchMock = installFetchMock(50)
    render(<App />)

    expect(await screen.findByText('第 1 / 5 页 · 每页 10 场')).toBeInTheDocument()
    for (let page = 1; page < 5; page += 1) {
      fireEvent.click(screen.getByRole('button', { name: '下一页' }))
      expect(await screen.findByText(`第 ${page + 1} / 5 页 · 每页 10 场`)).toBeInTheDocument()
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`offset=${page * 10}`), expect.anything())
    }
    expect(await screen.findByText('历史战局 50')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '上一页' }))
    expect(await screen.findByText('第 4 / 5 页 · 每页 10 场')).toBeInTheDocument()
  })

  it('submits a valid battle and renders the returned topic', async () => {
    const fetchMock = installFetchMock()
    render(<App />)
    await screen.findByRole('heading', { name: '已有战局', level: 2 })
    fireEvent.change(screen.getByRole('textbox', { name: /^攻防主题/ }), { target: { value: '新战局' } })
    fireEvent.click(screen.getByRole('button', { name: /开始攻防/ }))

    await waitFor(() => expect(screen.getByText('战局创建完成')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/battles'), expect.objectContaining({ method: 'POST' }))
    expect(screen.getByRole('heading', { name: '新战局' })).toBeInTheDocument()
  })

  it('re-reads the created battle by id before confirming persistence', async () => {
    const fetchMock = installFetchMock()
    const baseline = fetchMock.getMockImplementation()!
    const persistedBattle = { ...battle, id: 'battle-new', topic: '已持久化回读', status: 'pending' }
    fetchMock.mockImplementation((input, init) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/battles/battle-new') && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify(persistedBattle), { status: 200 }))
      }
      return baseline(input, init)
    })
    render(<App />)

    await screen.findByRole('heading', { name: '已有战局', level: 2 })
    fireEvent.change(screen.getByRole('textbox', { name: /^攻防主题/ }), { target: { value: '新战局' } })
    fireEvent.click(screen.getByRole('button', { name: /开始攻防/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/battles/battle-new'), expect.anything()))
    expect(await screen.findByRole('heading', { name: '已持久化回读' })).toBeInTheDocument()
    expect(screen.getByText('战局创建完成')).toBeInTheDocument()
  })

  it('does not report successful creation when the created battle cannot be read back', async () => {
    const fetchMock = installFetchMock()
    const baseline = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((input, init) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/battles/battle-new') && !init?.method) {
        return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
      }
      return baseline(input, init)
    })
    render(<App />)

    await screen.findByRole('heading', { name: '已有战局', level: 2 })
    fireEvent.change(screen.getByRole('textbox', { name: /^攻防主题/ }), { target: { value: '新战局' } })
    fireEvent.click(screen.getByRole('button', { name: /开始攻防/ }))

    expect(await screen.findByText(/创建请求已提交，但暂时无法回读战局详情/)).toBeInTheDocument()
    expect(screen.queryByText('战局创建完成')).not.toBeInTheDocument()
  })

  it('shows a retryable health state when the health check fails', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input).endsWith('/health')) return Promise.reject(new TypeError('offline'))
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    expect(await screen.findByRole('button', { name: /服务连接失败/ })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/health'), expect.anything())
  })

  it('keeps unknown agent sources visible instead of mislabeling them', async () => {
    installFetchMock(21, 'future-agent', 'future-agent')
    render(<App />)

    expect(await screen.findByText('攻击来源：来源未知（future-agent）')).toBeInTheDocument()
    expect(screen.getByText('防守来源：来源未知（future-agent）')).toBeInTheDocument()
  })

  it('keeps the public experience available when backend organization authentication is enabled', async () => {
    const fetchMock = installFetchMock(21, 'acp-llm', 'acp-rule-fallback', { enabled: true, authenticated: false })
    render(<App />)

    expect(await screen.findByRole('heading', { name: '已有战局', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '开始新战局（New battle）' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/battles?'), expect.anything())
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/auth/session'), expect.anything())

    fireEvent.change(screen.getByRole('textbox', { name: /^攻防主题/ }), { target: { value: '公开体验' } })
    fireEvent.click(screen.getByRole('button', { name: /开始攻防/ }))
    expect(await screen.findByText('战局创建完成')).toBeInTheDocument()
  })

  it('loads internal scores and deletes a finished battle', async () => {
    const fetchMock = installFetchMock()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<App />)

    expect(await screen.findByRole('heading', { name: '已有战局', level: 2 })).toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/battles/battle-test/score'), expect.anything()))
    expect(await screen.findByText(/攻击方：65 \/ 100/)).toBeInTheDocument()
    expect(screen.getByText(/防守方：80 \/ 100/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '删除战局' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/battles/battle-test'), expect.objectContaining({ method: 'DELETE' })))
    expect(await screen.findByText('战局已删除')).toBeInTheDocument()
    confirmSpy.mockRestore()
  })

  it('ignores a late score response after selecting another battle', async () => {
    const fetchMock = installFetchMock()
    const baseline = fetchMock.getMockImplementation()!
    let resolveOldScore!: (response: Response) => void
    const oldScore = new Promise<Response>((resolve) => { resolveOldScore = resolve })
    fetchMock.mockImplementation((input, init) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/battle-test/score')) return oldScore
      return baseline(input, init)
    })
    render(<App />)

    expect(await screen.findByRole('heading', { name: '已有战局', level: 2 })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /历史战局 2/ }))
    expect(await screen.findByText(/攻击方：65 \/ 100/)).toBeInTheDocument()

    resolveOldScore(new Response(JSON.stringify({
      version: 'internal-agent-v2',
      status: 'scored',
      attacker: { status: 'scored', score: 99, maxScore: 100, categories: [] },
      defender: { status: 'scored', score: 99, maxScore: 100, categories: [] },
    }), { status: 200 }))

    await waitFor(() => expect(screen.queryByText(/攻击方：99 \/ 100/)).not.toBeInTheDocument())
    expect(screen.getByText(/攻击方：65 \/ 100/)).toBeInTheDocument()
  })

  it('ignores a late score response from before retrying the same failed battle', async () => {
    window.history.replaceState({}, '', '/?battle_id=battle-test')
    const fetchMock = installFetchMock()
    const baseline = fetchMock.getMockImplementation()!
    let resolveOldScore!: (response: Response) => void
    const oldScore = new Promise<Response>((resolve) => { resolveOldScore = resolve })
    fetchMock.mockImplementation((input, init) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/battle-test/score')) return oldScore
      if (url.pathname.endsWith('/battle-test/retry') && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ ...battle, status: 'pending' }), { status: 202 }))
      }
      if (url.pathname.endsWith('/battles/battle-test')) {
        return Promise.resolve(new Response(JSON.stringify({ ...battle, status: 'failed' }), { status: 200 }))
      }
      return baseline(input, init)
    })
    render(<App />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/battles/battle-test/score'), expect.anything()))
    fireEvent.click(await screen.findByRole('button', { name: '重试失败战局' }))
    expect(await screen.findByText('失败战局已重新提交')).toBeInTheDocument()
    expect(screen.getAllByText(/等待中（Pending）/).length).toBeGreaterThan(0)

    await act(async () => {
      resolveOldScore(new Response(JSON.stringify({
        version: 'internal-agent-v2',
        status: 'scored',
        attacker: { status: 'scored', score: 99, maxScore: 100, categories: [] },
        defender: { status: 'scored', score: 99, maxScore: 100, categories: [] },
      }), { status: 200 }))
      await oldScore
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await waitFor(() => expect(screen.queryByText(/攻击方：99 \/ 100/)).not.toBeInTheDocument())
    expect(screen.queryByText('正在计算攻击与防守评分…')).not.toBeInTheDocument()
  })
})

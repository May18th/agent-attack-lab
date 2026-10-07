import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const battle = {
  id: 'battle-test',
  difficulty: 'low' as const,
  topic: '已有战局',
  status: 'completed',
  createdAt: '2026-10-07T00:00:00Z',
  attackerOut: { samples: [{ type: 'defect', topic: '已有战局', severity: 'low', content: 'sample' }] },
  defenderOut: [{ caught: [], risks: [], fixed: [] }],
}

function installFetchMock(totalBattles = 21) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/health')) return Promise.resolve(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
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
      return Promise.resolve(new Response(JSON.stringify({ ...battle, id: 'battle-new', topic: '新战局' }), { status: 201 }))
    }
    if (url.pathname.endsWith('/battles') && init?.method !== 'POST') {
      const query = url.searchParams.get('q')?.toLowerCase() ?? ''
      const matching = Array.from({ length: totalBattles }, (_, index) => index)
        .filter((index) => !query || `历史战局 ${index + 1}`.toLowerCase().includes(query) || `battle-${index + 1}`.includes(query))
      const offset = Number(url.searchParams.get('offset') ?? '0')
      const limit = Number(url.searchParams.get('limit') ?? '10')
      const items = matching.slice(offset, offset + limit).map((index) => index === 0 ? battle : {
        ...battle,
        id: `battle-${index + 1}`,
        topic: `历史战局 ${index + 1}`,
      })
      return Promise.resolve(new Response(JSON.stringify(items), {
        status: 200,
        headers: { 'X-Total-Count': String(matching.length) },
      }))
    }
    if (url.pathname.includes('/battles/')) {
      const id = decodeURIComponent(url.pathname.split('/').at(-1) ?? '')
      return Promise.resolve(new Response(JSON.stringify(id === battle.id ? battle : { ...battle, id, topic: '已恢复回放' }), { status: 200 }))
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

    fireEvent.click(screen.getByRole('button', { name: /已有战局/ }))
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('battle_id')).toBe('battle-test'))
    fireEvent.change(screen.getByRole('textbox', { name: /^测试主题/ }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /开始攻防/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('请输入测试主题')
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/battles'), expect.objectContaining({ method: 'POST' }))
  })

  it('prefills topic and difficulty from URL parameters', async () => {
    window.history.replaceState({}, '', '/?topic=%E8%AE%A2%E5%8D%95%E6%9F%A5%E8%AF%A2%E6%9D%83%E9%99%90%E6%A0%A1%E9%AA%8C&difficulty=high')
    installFetchMock()
    const view = render(<App />)

    expect(await screen.findByRole('textbox', { name: /^测试主题/ })).toHaveValue('订单查询权限校验')
    expect(view.container.querySelector<HTMLInputElement>('input[name="difficulty"]:checked')?.parentElement?.textContent).toContain('高（High）')
  })

  it('keeps the existing defaults when URL parameters are absent', async () => {
    installFetchMock()
    const view = render(<App />)

    expect(await screen.findByRole('textbox', { name: /^测试主题/ })).toHaveValue('提示注入与输入校验')
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
    fireEvent.change(screen.getByRole('textbox', { name: /^测试主题/ }), { target: { value: '新战局' } })
    fireEvent.click(screen.getByRole('button', { name: /开始攻防/ }))

    await waitFor(() => expect(screen.getByText('战局创建完成')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/battles'), expect.objectContaining({ method: 'POST' }))
    expect(screen.getByRole('heading', { name: '新战局' })).toBeInTheDocument()
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
})

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

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function installFetchMock() {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/health')) return Promise.resolve(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
    if (url.includes('/battles?limit=50')) return Promise.resolve(new Response(JSON.stringify([battle]), { status: 200 }))
    if (init?.method === 'POST') return Promise.resolve(new Response(JSON.stringify({ ...battle, topic: '新战局' }), { status: 201 }))
    return Promise.resolve(new Response(JSON.stringify(battle), { status: 200 }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('App', () => {
  it('loads history and shows an inline validation error for an empty topic', async () => {
    const fetchMock = installFetchMock()
    render(<App />)

    expect(await screen.findByRole('heading', { name: '已有战局', level: 2 })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /已有战局/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/battles/battle-test'), expect.anything()))
    fireEvent.change(screen.getByRole('textbox', { name: /^测试主题/ }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '开始攻防' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('请输入测试主题')
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/battles'), expect.objectContaining({ method: 'POST' }))
  })

  it('submits a valid battle and renders the returned topic', async () => {
    const fetchMock = installFetchMock()
    render(<App />)
    await screen.findByRole('heading', { name: '已有战局', level: 2 })
    fireEvent.change(screen.getByRole('textbox', { name: /^测试主题/ }), { target: { value: '新战局' } })
    fireEvent.click(screen.getByRole('button', { name: '开始攻防' }))

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


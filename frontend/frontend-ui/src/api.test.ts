import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, apiErrorMessage, apiPage, errorMessage, getBrowserSession, loginBrowser } from './api'

afterEach(() => vi.unstubAllGlobals())

describe('api error handling', () => {
  it('maps validation responses without exposing a stack trace', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ detail: [{ msg: 'String should have at least 1 character' }] }),
      { status: 422, headers: { 'Content-Type': 'application/json', 'X-Request-ID': 'request-test' } },
    )))

    await expect(api('/battles')).rejects.toMatchObject({ status: 422, requestId: 'request-test' })
    expect(errorMessage(422)).toContain('输入不符合要求')
    expect(apiErrorMessage(new Error('内部堆栈'))).toBe('内部堆栈')
  })

  it.each([
    [404, '战局不存在或已被删除'],
    [429, '请求失败（HTTP 429）'],
    [500, '服务暂时不可用，请稍后重试'],
  ])('maps HTTP %s to a user-facing message', (status, message) => {
    expect(errorMessage(status)).toBe(message)
  })

  it('maps network failures to a recoverable message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))

    await expect(api('/health')).rejects.toMatchObject({ status: 0, message: '无法连接后端服务，请检查 API 地址和服务状态' })
  })

  it('turns a successful non-JSON response into a clear error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Hello world', {
      status: 200,
      headers: { 'Content-Type': 'text/plain', 'X-Request-ID': 'request-html' },
    })))

    await expect(api('/health')).rejects.toMatchObject({
      status: 200,
      requestId: 'request-html',
      message: '后端返回了无效响应',
    })
  })

  it('reads the server-side total for paginated results', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 'battle-2' }]), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'X-Total-Count': '50' },
    })))

    await expect(apiPage<{ id: string }>('/battles?limit=10&offset=10')).resolves.toEqual({
      items: [{ id: 'battle-2' }],
      total: 50,
    })
  })

  it('falls back to the current page size if a gateway strips the total header', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 'battle-1' }]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))

    await expect(apiPage<{ id: string }>('/battles?limit=10&offset=0')).resolves.toEqual({
      items: [{ id: 'battle-1' }],
      total: 1,
    })
  })

  it('uses browser credentials for session login and status checks', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ authenticated: true, expiresInSeconds: 28800 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ enabled: true, authenticated: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ enabled: true, authenticated: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(loginBrowser('browser-secret')).resolves.toEqual({ enabled: true, authenticated: true })
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', credentials: 'include' })
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ credentials: 'include' })
    await expect(getBrowserSession()).resolves.toEqual({ enabled: true, authenticated: true })
  })
})


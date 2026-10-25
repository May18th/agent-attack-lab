import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

async function getEntryPage(pathname: string) {
  window.history.replaceState({}, '', pathname)
  vi.resetModules()

  const render = vi.fn()
  vi.doMock('react-dom/client', () => ({ createRoot: () => ({ render }) }))
  vi.doMock('./App.tsx', () => ({ default: 'PublicApp' }))
  vi.doMock('./AdminApp.tsx', () => ({ default: 'AdminApp' }))

  await import('./main')

  const root = render.mock.calls[0]?.[0] as ReactElement<{ children: ReactElement<{ type: string }> }>
  return root.props.children.type
}

describe('main app entry routing', () => {
  it.each(['/dashboard', '/dashboard/'])('opens the admin app at %s', async (pathname) => {
    await expect(getEntryPage(pathname)).resolves.toBe('AdminApp')
  })

  it.each(['/admin', '/admin/', '/admin/battles'])('keeps the admin app at %s', async (pathname) => {
    await expect(getEntryPage(pathname)).resolves.toBe('AdminApp')
  })

  it.each(['/', '/dashboard-extra'])('keeps the public app at %s', async (pathname) => {
    await expect(getEntryPage(pathname)).resolves.toBe('PublicApp')
  })

  it.each(['/admin', '/admin/', '/dashboard', '/dashboard/'])('sets the administrator title at %s', async (pathname) => {
    await getEntryPage(pathname)
    expect(document.title).toBe('智能体攻防实验室 · 管理员后台')
  })

  it('sets the public title for the root experience', async () => {
    await getEntryPage('/')
    expect(document.title).toBe('智能体攻防实验室 · 公开体验')
  })
})

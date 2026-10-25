import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

async function getEntryPage() {
  vi.resetModules()

  const render = vi.fn()
  vi.doMock('react-dom/client', () => ({ createRoot: () => ({ render }) }))
  vi.doMock('./AdminApp.tsx', () => ({ default: 'AdminApp' }))

  await import('./main')

  const root = render.mock.calls[0]?.[0] as ReactElement<{ children: ReactElement<{ type: string }> }>
  return root.props.children.type
}

describe('administrator entry', () => {
  it('renders the administrator app', async () => {
    await expect(getEntryPage()).resolves.toBe('AdminApp')
  })

  it('sets the administrator title', async () => {
    await getEntryPage()
    expect(document.title).toBe('智能体攻防实验室 · 管理员后台')
  })
})

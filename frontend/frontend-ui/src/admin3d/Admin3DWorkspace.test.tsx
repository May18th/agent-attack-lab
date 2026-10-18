import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminBattle, AdminMetrics } from '../adminApi'
import type { ExternalCase } from '../api'
import type { AdminSceneModel, AdminSceneNode } from './sceneModel'
import { Admin3DWorkspace } from './Admin3DWorkspace'

const sceneMock = vi.hoisted(() => ({
  model: undefined as AdminSceneModel | undefined,
  onSelectNode: undefined as ((node: AdminSceneNode) => void) | undefined,
  paused: false,
  resetCount: 0,
}))

vi.mock('./ThreeScene', () => ({
  ThreeScene: class {
    mount(_container: HTMLElement, model: AdminSceneModel, options: { onSelectNode?: (node: AdminSceneNode) => void }) {
      sceneMock.model = model
      sceneMock.onSelectNode = options.onSelectNode
    }
    update(model: AdminSceneModel) { sceneMock.model = model }
    setMotionPaused(paused: boolean) { sceneMock.paused = paused }
    resetCamera() { sceneMock.resetCount += 1 }
    dispose() {}
  },
}))

const battle: AdminBattle = {
  id: 'battle-1', difficulty: 'mid', topic: '登录态验证', status: 'running', createdAt: '2026-10-19T00:00:00Z',
  attackerOut: { samples: [] }, defenderOut: [],
}
const externalCase: ExternalCase = {
  externalId: 'CVE-2026-1234', vendorProject: 'Example', product: 'Gateway', title: '边界认证绕过',
  dateAdded: '2026-10-18', description: '', requiredAction: '', cwes: [], sourceUrl: 'https://example.test/cve',
  provenanceStatus: 'verified', synthetic: false, recordKind: 'catalog',
  source: { publisher: 'Example', sourceType: 'feed', catalogVersion: '1', retrievedAt: '2026-10-19', contentSha256: 'abcdef123456' },
}

const renderWorkspace = (overrides: Partial<Parameters<typeof Admin3DWorkspace>[0]> = {}) => {
  const props = {
    metrics: { queue: 2 } as AdminMetrics,
    battles: [battle],
    cases: { available: true, items: [externalCase], total: 1, sourceCount: 1 },
    selectedBattle: null,
    detailData: {},
    onSelectBattle: () => {},
    ...overrides,
  }
  return render(<Admin3DWorkspace {...props} />)
}

beforeEach(() => {
  sceneMock.model = undefined
  sceneMock.onSelectNode = undefined
  sceneMock.paused = false
  sceneMock.resetCount = 0
})
afterEach(cleanup)

describe('Admin3DWorkspace', () => {
  it('shows the 3D scene by default', () => {
    renderWorkspace()
    expect(screen.getByRole('region', { name: '3D 攻防态势' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '态势总览', selected: true })).toBeInTheDocument()
    expect(sceneMock.model?.nodes.some(node => node.kind === 'battle')).toBe(true)
  })

  it('switches among the four in-admin views', () => {
    renderWorkspace({ selectedBattle: battle, detailData: { 审计: { traceId: 'trace-1' } } })
    fireEvent.click(screen.getByRole('tab', { name: '审计' }))
    expect(screen.getByText(/trace-1/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '案例' }))
    expect(screen.getByRole('list', { name: '外部案例节点' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '战局' }))
    expect(screen.getByText('登录态验证')).toBeInTheDocument()
  })

  it('forwards a selected battle node without running an action', () => {
    const onSelectBattle = vi.fn()
    renderWorkspace({ onSelectBattle })
    const battleNode = sceneMock.model?.nodes.find(node => node.kind === 'battle')
    expect(battleNode).toBeDefined()
    sceneMock.onSelectNode?.(battleNode!)
    expect(onSelectBattle).toHaveBeenCalledWith(battle)
  })

  it('keeps external cases as standalone scene nodes', () => {
    renderWorkspace()
    expect(sceneMock.model?.nodes.find(node => node.kind === 'external-case')?.id).toBe('case:CVE-2026-1234')
    expect(sceneMock.model?.edges.some(edge => edge.from === 'case:CVE-2026-1234' || edge.to === 'case:CVE-2026-1234')).toBe(false)
  })

  it('provides pause, reset, and 2D navigation controls', () => {
    renderWorkspace()
    fireEvent.click(screen.getByRole('button', { name: '暂停动效' }))
    expect(sceneMock.paused).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '重置视角' }))
    expect(sceneMock.resetCount).toBe(1)
    expect(screen.getByRole('button', { name: '查看 2D 列表' })).toBeInTheDocument()
  })
})

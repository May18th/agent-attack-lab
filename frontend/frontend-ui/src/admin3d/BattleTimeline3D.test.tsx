import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminBattle, AdminBattleEvent } from '../adminApi'
import { BattleTimeline3D } from './BattleTimeline3D'
import { buildBattleTimelineSceneModel } from './sceneModel'

const battle: AdminBattle = {
  id: 'battle-1', topic: '验证事件轨迹', difficulty: 'high', status: 'running', createdAt: '2026-10-19T00:00:00Z',
  attackerOut: { samples: [] }, defenderOut: [],
}

afterEach(cleanup)

describe('BattleTimeline3D', () => {
  it('renders the complete event history in sequence order as a 2D list', () => {
    const events: AdminBattleEvent[] = [
      { sequence: 3, type: '完成', timestamp: '2026-10-19T00:03:00Z' },
      { sequence: 1, type: '启动', timestamp: '2026-10-19T00:01:00Z' },
      { sequence: 2, type: '检测', timestamp: '2026-10-19T00:02:00Z' },
    ]
    render(<BattleTimeline3D battle={battle} events={events} audit={{ actor: 'masked-user' }} selectedEvent={null} onSelectEvent={vi.fn()} />)

    expect(screen.getByRole('list', { name: '战局事件列表' })).toBeInTheDocument()
    const buttons = screen.getAllByRole('button', { name: /第 [123] 条事件/ })
    expect(buttons.map((button) => button.textContent)).toEqual([
      expect.stringContaining('启动'),
      expect.stringContaining('检测'),
      expect.stringContaining('完成'),
    ])
    expect(screen.getByText(/actor/)).toBeInTheDocument()
    expect(screen.getByText(/battle-1/)).toBeInTheDocument()
  })

  it('reports the selected event without triggering an operation', () => {
    const event: AdminBattleEvent = { sequence: 7, type: '检测完成', status: 'ok' }
    const onSelectEvent = vi.fn()
    render(<BattleTimeline3D battle={battle} events={[event]} audit={{}} selectedEvent={null} onSelectEvent={onSelectEvent} />)

    fireEvent.click(screen.getByRole('button', { name: /第 7 条事件/ }))

    expect(onSelectEvent).toHaveBeenCalledExactlyOnceWith(event)
    expect(screen.queryByRole('button', { name: /重试|取消|删除|执行/ })).not.toBeInTheDocument()
  })

  it('shows an empty state when the selected battle has no events', () => {
    render(<BattleTimeline3D battle={battle} events={[]} audit={{}} selectedEvent={null} onSelectEvent={vi.fn()} />)
    expect(screen.getByText('本场暂无事件')).toBeInTheDocument()
  })

  it('keeps selected event in sync with the 3D replay controller', () => {
    const event: AdminBattleEvent = { sequence: 7, type: '旧战局事件' }
    render(<BattleTimeline3D battle={battle} events={[event]} audit={{}} selectedEvent={event} onSelectEvent={vi.fn()} />)
    expect(screen.getByRole('button', { name: /第 7 条事件/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('builds a sequence-ordered replay path from stored events', () => {
    const events: AdminBattleEvent[] = [{ sequence: 2, type: '第二步' }, { sequence: 1, type: '第一步' }]
    const model = buildBattleTimelineSceneModel(battle, events)
    expect(model.nodes.filter((node) => node.kind === 'timeline-event').map((node) => (node.source as AdminBattleEvent).sequence)).toEqual([1, 2])
    expect(model.edges.filter((edge) => edge.kind === 'timeline')).toHaveLength(1)
    expect(model.edges.find((edge) => edge.kind === 'timeline')).toMatchObject({ from: 'event:battle-1:1:1', to: 'event:battle-1:2:0' })
    expect(model.edges.filter((edge) => edge.kind === 'network')).toHaveLength(9)
  })

  it('filters recorded events by searchable event data', () => {
    const events: AdminBattleEvent[] = [
      { sequence: 1, type: 'attack.sample.generated', data: { sample: 'alpha-marker' } },
      { sequence: 2, type: 'round.completed', data: { sample: 'beta-marker' } },
    ]
    render(<BattleTimeline3D battle={battle} events={events} audit={{}} selectedEvent={null} onSelectEvent={vi.fn()} />)

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索事件记录' }), { target: { value: 'beta-marker' } })

    expect(screen.getByRole('button', { name: /第 2 条事件/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /第 1 条事件/ })).not.toBeInTheDocument()
  })

  it('exports the unfiltered source event sequence as JSON', async () => {
    const events: AdminBattleEvent[] = [{ sequence: 1, type: 'audit.evidence', data: { ip: '192.0.2.8' } }]
    const createObjectURL = vi.fn<(value: Blob) => string>(() => 'blob:events')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<BattleTimeline3D battle={battle} events={events} audit={{}} selectedEvent={null} onSelectEvent={vi.fn()} />)

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索事件记录' }), { target: { value: 'not-found' } })
    fireEvent.click(screen.getByRole('button', { name: '导出事件' }))

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    const exported = await (createObjectURL.mock.calls[0][0] as Blob).text()
    expect(JSON.parse(exported)).toMatchObject({ battleId: battle.id, events: [{ sequence: 1, data: { ip: '192.0.2.8' } }] })
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:events')
    vi.unstubAllGlobals()
  })

  it('labels partial exports and marks their JSON as incomplete', async () => {
    const createObjectURL = vi.fn<(value: Blob) => string>(() => 'blob:partial-events')
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<BattleTimeline3D battle={battle} events={[{ sequence: 1, type: '第一页' }]} audit={{}} eventsTotal={201} hasMoreEvents selectedEvent={null} onSelectEvent={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '导出已加载事件' }))

    const exported = await createObjectURL.mock.calls[0][0].text()
    expect(JSON.parse(exported)).toMatchObject({ complete: false, events: [{ sequence: 1 }] })
    expect(click).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })
})

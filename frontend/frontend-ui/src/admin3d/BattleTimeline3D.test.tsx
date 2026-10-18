import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminBattle, AdminBattleEvent } from '../adminApi'
import { BattleTimeline3D } from './BattleTimeline3D'
import { buildBattleTimelineSceneModel } from './sceneModel'

const battle: AdminBattle = {
  id: 'battle-1',
  topic: '验证事件轨迹',
  difficulty: 'high',
  status: 'running',
  createdAt: '2026-10-19T00:00:00Z',
  attackerOut: { samples: [] },
  defenderOut: [],
}

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('BattleTimeline3D', () => {
  it('renders events in ascending sequence order for the selected battle', () => {
    const events: AdminBattleEvent[] = [
      { sequence: 3, type: '完成', timestamp: '2026-10-19T00:03:00Z' },
      { sequence: 1, type: '启动', timestamp: '2026-10-19T00:01:00Z' },
      { sequence: 2, type: '检测', timestamp: '2026-10-19T00:02:00Z' },
    ]
    render(<BattleTimeline3D battle={battle} events={events} audit={{ actor: 'masked-user' }} onSelectEvent={vi.fn()} />)

    expect(screen.getByRole('region', { name: '3D 战局事件轨迹' })).toBeInTheDocument()
    const buttons = screen.getAllByRole('button', { name: /第 [123] 条事件/ })
    expect(buttons.map((button) => button.textContent)).toEqual([
      expect.stringContaining('启动'),
      expect.stringContaining('检测'),
      expect.stringContaining('完成'),
    ])
    expect(screen.getByText(/masked-user/)).toBeInTheDocument()
    expect(screen.getByText(/battle-1/)).toBeInTheDocument()
  })

  it('reports only the selected event without triggering an operation', () => {
    const event: AdminBattleEvent = { sequence: 7, type: '检测完成', status: 'ok' }
    const onSelectEvent = vi.fn()
    render(<BattleTimeline3D battle={battle} events={[event]} audit={{}} onSelectEvent={onSelectEvent} />)

    fireEvent.click(screen.getByRole('button', { name: /第 7 条事件/ }))

    expect(onSelectEvent).toHaveBeenCalledExactlyOnceWith(event)
    expect(screen.queryByRole('button', { name: /重试|取消|删除|执行/ })).not.toBeInTheDocument()
  })

  it('shows an empty state when the selected battle has no events', () => {
    render(<BattleTimeline3D battle={battle} events={[]} audit={{}} onSelectEvent={vi.fn()} />)

    expect(screen.getByText('本场暂无事件')).toBeInTheDocument()
  })

  it('clears the selected event when the selected battle changes', () => {
    const event: AdminBattleEvent = { sequence: 7, type: '旧战局事件' }
    const onSelectEvent = vi.fn()
    const { rerender } = render(<BattleTimeline3D battle={battle} events={[event]} audit={{}} onSelectEvent={onSelectEvent} />)
    fireEvent.click(screen.getByRole('button', { name: /第 7 条事件/ }))
    expect(screen.getByRole('button', { name: /第 7 条事件/ })).toHaveAttribute('aria-pressed', 'true')

    rerender(<BattleTimeline3D battle={{ ...battle, id: 'battle-2', topic: '另一战局' }} events={[event]} audit={{}} onSelectEvent={onSelectEvent} />)

    expect(screen.getByRole('button', { name: /第 7 条事件/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByText(/已选事件/)).not.toBeInTheDocument()
  })

  it('builds a sequence-ordered 3D event track with selectable event sources and no case links', () => {
    const events: AdminBattleEvent[] = [
      { sequence: 2, type: '第二步' },
      { sequence: 1, type: '第一步' },
    ]
    const model = buildBattleTimelineSceneModel(battle, events)

    expect(model.nodes.map((node) => node.kind)).toEqual(['timeline-event', 'timeline-event'])
    expect(model.nodes.map((node) => (node.source as AdminBattleEvent).sequence)).toEqual([1, 2])
    expect(model.edges).toHaveLength(1)
    expect(model.edges[0]).toMatchObject({ from: 'event:battle-1:1:0', to: 'event:battle-1:2:1' })
    expect(model.nodes.every((node) => node.position.some((coordinate) => coordinate !== 0))).toBe(true)
    expect(model.nodes.some((node) => node.kind === 'external-case')).toBe(false)
  })
})

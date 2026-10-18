import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AdminBattle, AdminBattleEvent } from '../adminApi'
import { BattleTimeline3D } from './BattleTimeline3D'

const battle: AdminBattle = {
  id: 'battle-1',
  topic: '验证事件轨迹',
  difficulty: 'high',
  status: 'running',
  createdAt: '2026-10-19T00:00:00Z',
  attackerOut: { samples: [] },
  defenderOut: [],
}

describe('BattleTimeline3D', () => {
  it('renders events in ascending sequence order for the selected battle', () => {
    const events: AdminBattleEvent[] = [
      { sequence: 3, type: '完成', timestamp: '2026-10-19T00:03:00Z' },
      { sequence: 1, type: '启动', timestamp: '2026-10-19T00:01:00Z' },
      { sequence: 2, type: '检测', timestamp: '2026-10-19T00:02:00Z' },
    ]
    render(<BattleTimeline3D battle={battle} events={events} audit={{ actor: 'masked-user' }} onSelectEvent={vi.fn()} />)

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
})

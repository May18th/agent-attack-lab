import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminBattle, AdminBattleEvent } from '../adminApi'
import type { AdminSceneModel, AdminSceneNode } from './sceneModel'
import { Admin3DWorkspace } from './Admin3DWorkspace'

const sceneMock = vi.hoisted(() => ({
  model: undefined as AdminSceneModel | undefined,
  onSelectNode: undefined as ((node: AdminSceneNode) => void) | undefined,
  activeNode: undefined as string | undefined,
  activeNodeAnimated: false,
  playbackPaused: true,
  resetCount: 0,
}))

vi.mock('./ThreeScene', () => ({
  ThreeScene: class {
    mount(_container: HTMLElement, model: AdminSceneModel, options: { onSelectNode?: (node: AdminSceneNode) => void }) {
      sceneMock.model = model
      sceneMock.onSelectNode = options.onSelectNode
    }
    update(model: AdminSceneModel) { sceneMock.model = model }
    setActiveNode(id?: string, animate = false) { sceneMock.activeNode = id; sceneMock.activeNodeAnimated = animate }
    setPlaybackPaused(paused: boolean) { sceneMock.playbackPaused = paused }
    resetCamera() { sceneMock.resetCount += 1 }
    dispose() {}
  },
}))

const battle: AdminBattle = {
  id: 'battle-1', difficulty: 'mid', topic: '登录态验证', status: 'running', createdAt: '2026-10-19T00:00:00Z',
  attackerOut: { samples: [] }, defenderOut: [],
}
const renderWorkspace = (overrides: Partial<Parameters<typeof Admin3DWorkspace>[0]> = {}) => {
  const props = {
    battles: [battle],
    selectedBattle: null,
    events: [],
    selectedEvent: null,
    onSelectBattle: () => {},
    onSelectEvent: () => {},
    ...overrides,
  }
  return render(<Admin3DWorkspace {...props} />)
}

beforeEach(() => {
  sceneMock.model = undefined
  sceneMock.onSelectNode = undefined
  sceneMock.activeNode = undefined
  sceneMock.activeNodeAnimated = false
  sceneMock.playbackPaused = true
  sceneMock.resetCount = 0
})
afterEach(cleanup)

describe('Admin3DWorkspace', () => {
  it('renders an actual selected battle replay with transport controls', () => {
    const events: AdminBattleEvent[] = [
      { sequence: 1, type: '攻击请求', timestamp: '2026-10-19T00:00:01Z' },
      { sequence: 2, type: '防守拦截', timestamp: '2026-10-19T00:00:02Z' },
    ]
    renderWorkspace({ selectedBattle: battle, events })
    expect(screen.getByRole('region', { name: '3D 战局回放' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '播放回放' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: '回放进度' })).toBeInTheDocument()
    expect(sceneMock.model?.nodes.filter(node => node.kind === 'timeline-event').map(node => (node.source as AdminBattleEvent)?.sequence)).toEqual([1, 2])
    const speedSelect = screen.getByRole('combobox', { name: '回放速度' })
    expect(speedSelect.querySelector('option[value="0.25"]')).not.toBeNull()
    expect(speedSelect.querySelector('option[value="4"]')).not.toBeNull()
  })

  it('advances through recorded events and updates the active 3D node', () => {
    vi.useFakeTimers()
    const events: AdminBattleEvent[] = [
      { sequence: 1, type: '攻击请求' },
      { sequence: 2, type: '防守拦截' },
    ]
    const onSelectEvent = vi.fn()
    renderWorkspace({ selectedBattle: battle, events, onSelectEvent })
    fireEvent.click(screen.getByRole('button', { name: '播放回放' }))
    expect(onSelectEvent).toHaveBeenLastCalledWith(events[0])
    expect(sceneMock.activeNodeAnimated).toBe(true)
    act(() => { vi.advanceTimersByTime(2499) })
    expect(onSelectEvent).toHaveBeenLastCalledWith(events[0])
    act(() => { vi.advanceTimersByTime(1) })
    expect(onSelectEvent).toHaveBeenLastCalledWith(events[1])
    expect(sceneMock.activeNode).toContain('event:battle-1:2')
    vi.useRealTimers()
  })

  it('applies the selected playback speed to event timing', () => {
    vi.useFakeTimers()
    const events: AdminBattleEvent[] = [
      { sequence: 1, type: '攻击请求' },
      { sequence: 2, type: '防守拦截' },
    ]
    const onSelectEvent = vi.fn()
    renderWorkspace({ selectedBattle: battle, events, onSelectEvent })
    fireEvent.change(screen.getByRole('combobox', { name: '回放速度' }), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: '播放回放' }))

    act(() => { vi.advanceTimersByTime(1249) })
    expect(onSelectEvent).toHaveBeenLastCalledWith(events[0])
    act(() => { vi.advanceTimersByTime(1) })
    expect(onSelectEvent).toHaveBeenLastCalledWith(events[1])
    vi.useRealTimers()
  })

  it('preserves the current event duration when replay is paused and resumed', () => {
    vi.useFakeTimers()
    const events: AdminBattleEvent[] = [
      { sequence: 1, type: '攻击请求' },
      { sequence: 2, type: '防守拦截' },
    ]
    const onSelectEvent = vi.fn()
    renderWorkspace({ selectedBattle: battle, events, onSelectEvent })
    fireEvent.click(screen.getByRole('button', { name: '播放回放' }))
    act(() => { vi.advanceTimersByTime(1000) })
    fireEvent.click(screen.getByRole('button', { name: '暂停回放' }))
    act(() => { vi.advanceTimersByTime(5000) })
    expect(onSelectEvent).toHaveBeenLastCalledWith(events[0])

    fireEvent.click(screen.getByRole('button', { name: '播放回放' }))
    act(() => { vi.advanceTimersByTime(1499) })
    expect(onSelectEvent).toHaveBeenLastCalledWith(events[0])
    act(() => { vi.advanceTimersByTime(1) })
    expect(onSelectEvent).toHaveBeenLastCalledWith(events[1])
    vi.useRealTimers()
  })

  it('lets manual progress seeking jump directly without waiting for the playback interval', () => {
    vi.useFakeTimers()
    const events: AdminBattleEvent[] = [
      { sequence: 1, type: '扫描' },
      { sequence: 2, type: '攻击' },
      { sequence: 3, type: '沦陷' },
    ]
    const onSelectEvent = vi.fn()
    renderWorkspace({ selectedBattle: battle, events, onSelectEvent })
    fireEvent.change(screen.getByRole('slider', { name: '回放进度' }), { target: { value: '2' } })

    expect(onSelectEvent).toHaveBeenCalledWith(events[2])
    expect(sceneMock.activeNode).toContain('event:battle-1:3')
    vi.useRealTimers()
  })

  it('shows event-kind markers on the existing progress range and pauses scene cue timing', () => {
    const events: AdminBattleEvent[] = [
      { sequence: 1, type: 'attack.probe.started' },
      { sequence: 2, type: 'attack.started' },
      { sequence: 3, type: 'attack.compromised' },
    ]
    renderWorkspace({ selectedBattle: battle, events })
    const marks = screen.getAllByTestId('replay-event-marker')
    expect(marks.map(mark => mark.textContent)).toEqual(['扫描探测', '', ''])
    expect(marks.map(mark => (mark as HTMLElement).style.getPropertyValue('--marker-color'))).toEqual(['#00dfdc', '#ff9b56', '#ff4e64'])
    expect(screen.getByText('攻击跳板')).toBeInTheDocument()
    expect(screen.getByText('防守内网')).toBeInTheDocument()
    expect(screen.getByText('正常守护')).toBeInTheDocument()
    expect(screen.getByText('正在被探测')).toBeInTheDocument()
    expect(screen.getByText('遭受攻击')).toBeInTheDocument()
    expect(screen.getByText('已沦陷')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '播放回放' }))
    expect(sceneMock.playbackPaused).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '暂停回放' }))
    expect(sceneMock.playbackPaused).toBe(true)
  })

  it('keeps dense progress markers unlabeled except for the active event', () => {
    const events = Array.from({ length: 16 }, (_, index): AdminBattleEvent => ({ sequence: index + 1, type: `event.${index + 1}` }))
    renderWorkspace({ selectedBattle: battle, events })

    expect(screen.getAllByTestId('replay-event-marker')).toHaveLength(16)
    expect(document.querySelectorAll('.admin3d-progress-marker-label')).toHaveLength(1)
  })

  it('labels the active sample as an attacker-to-defender handoff', () => {
    const sampleEvent: AdminBattleEvent = {
      sequence: 1,
      type: 'attack.sample.generated',
      status: 'completed',
      data: { round: 1, sample: { content: 'recorded payload' } },
    }
    const defenderEvent: AdminBattleEvent = { sequence: 2, type: 'round.started', data: { round: 1 } }
    renderWorkspace({ selectedBattle: battle, events: [sampleEvent, defenderEvent] })

    fireEvent.click(screen.getByRole('button', { name: '播放回放' }))

    expect(screen.getByText('攻击方')).toBeInTheDocument()
    expect(screen.getByText('攻击方 → 防守方')).toBeInTheDocument()
  })

  it('explains defender findings and the final workflow outcome beside the event evidence', () => {
    const events: AdminBattleEvent[] = [
      { sequence: 1, type: 'attack.sample.generated', data: { round: 1, sample: { content: 'sample' } } },
      { sequence: 2, type: 'round.completed', data: { round: 1, caught: [{ ruleId: 'LAB-1' }], risks: [{ level: 'high' }], fixed: [{ action: '建议验证' }] } },
      { sequence: 3, type: 'battle.completed', status: 'completed' },
    ]
    renderWorkspace({ selectedBattle: battle, events })

    fireEvent.change(screen.getByRole('slider', { name: '回放进度' }), { target: { value: '1' } })
    expect(screen.getByText(/防守方完成第 1 轮检测：命中 1 条样本规则/)).toBeInTheDocument()
    expect(within(screen.getByRole('complementary')).getByText(/真实目标未验证/)).toBeInTheDocument()

    fireEvent.change(screen.getByRole('slider', { name: '回放进度' }), { target: { value: '2' } })
    expect(screen.getByText(/流程成功完成：生成 1 份攻击样本/)).toBeInTheDocument()
    expect(screen.getByText(/不代表攻击成功/)).toBeInTheDocument()
  })

  it('shows a prominent final summary as soon as a completed battle is selected', () => {
    const completedBattle = { ...battle, status: 'completed' }
    const events: AdminBattleEvent[] = [
      { sequence: 1, type: 'attack.sample.generated', data: { round: 1, sample: { content: 'sample' } } },
      { sequence: 2, type: 'round.completed', data: { round: 1, caught: [{ ruleId: 'LAB-1' }], risks: [], fixed: [] } },
      { sequence: 3, type: 'battle.completed', status: 'completed' },
    ]
    renderWorkspace({ selectedBattle: completedBattle, events })

    const summary = screen.getByRole('status', { name: '战局最终总结' })
    expect(summary).toHaveTextContent('流程成功完成：生成 1 份攻击样本')
    expect(summary).toHaveTextContent('不代表攻击成功')
    expect(summary).toHaveClass('admin3d-final-summary')
  })

  it('shows a recorded failure reason and does not invent one when evidence is missing', () => {
    renderWorkspace({ selectedBattle: battle, events: [
      { sequence: 1, type: 'agent.call.failed', data: { agentRole: 'attacker', error: '攻击调用超时' } },
      { sequence: 2, type: 'battle.failed' },
    ] })
    fireEvent.change(screen.getByRole('slider', { name: '回放进度' }), { target: { value: '1' } })
    expect(screen.getByText('流程中断：攻击方：攻击调用超时')).toBeInTheDocument()

    cleanup()
    renderWorkspace({ selectedBattle: battle, events: [{ sequence: 1, type: 'battle.failed' }] })
    fireEvent.click(screen.getByRole('button', { name: '播放回放' }))
    expect(screen.getByText(/无法确定具体中断环节/)).toBeInTheDocument()
  })

  it('labels actual high-difficulty rounds as one of three without synthesizing missing rounds', () => {
    const events: AdminBattleEvent[] = [
      { sequence: 1, type: 'round.completed', data: { round: 1, caught: [], risks: [], fixed: [] } },
      { sequence: 2, type: 'round.completed', data: { round: 2, caught: [], risks: [], fixed: [] } },
      { sequence: 3, type: 'round.completed', data: { round: 3, caught: [], risks: [], fixed: [] } },
    ]
    renderWorkspace({ selectedBattle: { ...battle, difficulty: 'high' }, events })
    fireEvent.change(screen.getByRole('slider', { name: '回放进度' }), { target: { value: '1' } })

    expect(screen.getByText('第 2 / 3 轮')).toBeInTheDocument()
  })

  it('selects a battle through the native selector', () => {
    const onSelectBattle = vi.fn()
    const otherBattle = { ...battle, id: 'battle-2', topic: '另一场战局' }
    renderWorkspace({ battles: [battle, otherBattle], onSelectBattle })
    fireEvent.change(screen.getByRole('combobox', { name: '选择战局回放' }), { target: { value: 'battle-2' } })
    expect(onSelectBattle).toHaveBeenCalledWith(otherBattle)
  })

  it('provides a one-click global view control and empty playback state', () => {
    renderWorkspace({ selectedBattle: battle, events: [{ sequence: 1, type: '启动' }] })
    fireEvent.click(screen.getByRole('button', { name: '全局视角' }))
    expect(sceneMock.resetCount).toBe(1)
  })

  it('offers to load the next event page when the server has more events', () => {
    const onLoadMoreEvents = vi.fn()
    renderWorkspace({
      selectedBattle: battle,
      events: [{ sequence: 1, type: '启动' }],
      eventsTotal: 201,
      hasMoreEvents: true,
      onLoadMoreEvents,
    })

    fireEvent.click(screen.getByRole('button', { name: '加载更多事件（1 / 201）' }))

    expect(onLoadMoreEvents).toHaveBeenCalledOnce()
  })

  it('does not offer a camera reset when there is no 3D replay scene', () => {
    renderWorkspace({ selectedBattle: battle })
    expect(screen.getByRole('button', { name: '全局视角' })).toBeDisabled()
    expect(screen.getByText('暂无事件，无法回放')).toBeInTheDocument()
  })
})

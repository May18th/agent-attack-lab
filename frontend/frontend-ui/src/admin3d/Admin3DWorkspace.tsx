import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { AdminBattle, AdminBattleEvent } from '../adminApi'
import { ThreeScene } from './ThreeScene'
import { buildBattleTimelineSceneModel, eventActorLabel, eventActorRole, eventFlowLabel, replayEventCue, replayEventSummary } from './sceneModel'

const REPLAY_EVENT_DURATION_MS = 2500
import './Admin3DWorkspace.css'

type Admin3DWorkspaceProps = {
  battles: AdminBattle[]
  selectedBattle: AdminBattle | null
  events: AdminBattleEvent[]
  eventsTotal?: number
  hasMoreEvents?: boolean
  loadingMoreEvents?: boolean
  onLoadMoreEvents?: () => void
  selectedEvent: AdminBattleEvent | null
  onSelectBattle: (battle: AdminBattle) => void
  onSelectEvent: (event: AdminBattleEvent) => void
}

const statusLabels: Record<string, string> = {
  pending: '等待中', running: '进行中', completed: '已完成', failed: '失败',
}

const expectedRounds: Record<string, number> = { low: 1, mid: 2, high: 3 }

function eventLabel(event: AdminBattleEvent): string {
  const type = String(event.eventType ?? event.type ?? '')
  const labels: Record<string, string> = {
    'attack.started': '攻击阶段开始',
    'attack.sample.generated': '攻击样本生成',
    'attack.completed': '攻击阶段完成',
    'agent.call.started': '智能体调用开始',
    'agent.call.completed': '智能体调用完成',
    'agent.call.failed': '智能体调用失败',
    'round.started': '防守检测开始',
    'round.completed': '本轮检测结果',
    'defense.completed': '防守阶段完成',
    'battle.completed': '战局完成',
    'battle.failed': '战局失败',
  }
  return (labels[type] ?? type) || String(event.status ?? '战局事件')
}

function eventDetails(event: AdminBattleEvent): string {
  return JSON.stringify(event.data ?? event, null, 2)
}

export function Admin3DWorkspace(props: Admin3DWorkspaceProps) {
  return <Admin3DReplay key={props.selectedBattle?.id ?? 'no-battle'} {...props} />
}

function Admin3DReplay({ battles, selectedBattle, events, eventsTotal = events.length, hasMoreEvents = false, loadingMoreEvents = false, onLoadMoreEvents, selectedEvent, onSelectBattle, onSelectEvent }: Admin3DWorkspaceProps) {
  const [playbackIndex, setPlaybackIndex] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const sceneContainerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<ThreeScene | null>(null)
  const replayClock = useRef({ eventIndex: -2, remainingMs: REPLAY_EVENT_DURATION_MS, startedAt: null as number | null })
  const model = useMemo(
    () => selectedBattle && events.length ? buildBattleTimelineSceneModel(selectedBattle, events) : null,
    [selectedBattle, events],
  )
  const modelRef = useRef(model)
  const orderedEvents = useMemo(() => events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => (left.event.sequence ?? Number.MAX_SAFE_INTEGER) - (right.event.sequence ?? Number.MAX_SAFE_INTEGER) || left.index - right.index)
    .map(({ event }) => event), [events])
  const eventsRef = useRef(orderedEvents)
  const selectEventRef = useRef(onSelectEvent)
  const selectedBattleId = selectedBattle?.id
  const hasModel = Boolean(model)
  const selectedEventIndex = selectedEvent ? orderedEvents.indexOf(selectedEvent) : -1
  const currentIndex = selectedEventIndex >= 0 ? selectedEventIndex : playbackIndex
  const currentEvent = currentIndex >= 0 ? orderedEvents[currentIndex] : undefined
  const finalEvent = [...orderedEvents].reverse().find((event) => {
    const type = String(event.eventType ?? event.type ?? '')
    return type === 'battle.completed' || type === 'battle.failed'
  })
  const showFinalSummary = Boolean(finalEvent || selectedBattle?.status === 'completed' || selectedBattle?.status === 'failed')
  const finalSummary = finalEvent
    ? replayEventSummary(finalEvent, orderedEvents)
    : selectedBattle?.status === 'failed'
      ? '战局已失败，但记录中缺少终局事件，无法确定中断原因。'
      : '战局已完成，但记录中缺少终局事件，无法汇总逐轮证据。真实目标验证状态无法确认。'
  const finalStatus = finalEvent
    ? String(finalEvent.eventType ?? finalEvent.type ?? '') === 'battle.failed' ? 'failed' : 'completed'
    : selectedBattle?.status ?? 'unknown'

  useLayoutEffect(() => {
    modelRef.current = model
    eventsRef.current = orderedEvents
    selectEventRef.current = onSelectEvent
  }, [model, orderedEvents, onSelectEvent])

  useEffect(() => {
    const container = sceneContainerRef.current
    const initialModel = modelRef.current
    if (!container || !selectedBattleId || !initialModel) return
    const scene = new ThreeScene()
    sceneRef.current = scene
    try {
      scene.mount(container, initialModel, {
        onSelectNode: (node) => {
          if (node.kind !== 'timeline-event' || !node.source || typeof node.source !== 'object') return
          const event = node.source as AdminBattleEvent
          const index = eventsRef.current.indexOf(event)
          if (index >= 0) {
            setPlaybackIndex(index)
            selectEventRef.current(event)
          }
        },
      })
    } catch (error) {
      const fallback = document.createElement('div')
      fallback.className = 'admin3d-scene-error'
      fallback.setAttribute('role', 'status')
      fallback.textContent = error instanceof Error ? error.message : '3D 回放暂不可用'
      container.appendChild(fallback)
    }
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => scene.resize())
    observer?.observe(container)
    return () => {
      observer?.disconnect()
      scene.dispose()
      sceneRef.current = null
    }
  }, [selectedBattleId, hasModel])

  useLayoutEffect(() => { if (model) sceneRef.current?.update(model) }, [model])

  useEffect(() => { sceneRef.current?.setPlaybackPaused(!playing) }, [playing, hasModel])

  useEffect(() => {
    if (!selectedEvent) return
    const index = orderedEvents.indexOf(selectedEvent)
    if (index < 0 || index === playbackIndex) return
    const node = model?.nodes.find((candidate) => candidate.source === selectedEvent)
    sceneRef.current?.setActiveNode(node?.id)
  }, [selectedEvent, orderedEvents, model, playbackIndex])

  useEffect(() => {
    if (!playing || !orderedEvents.length) return
    const clock = replayClock.current
    if (clock.eventIndex !== currentIndex) {
      clock.eventIndex = currentIndex
      clock.remainingMs = REPLAY_EVENT_DURATION_MS
    }
    clock.startedAt = performance.now()
    const timer = window.setTimeout(() => {
      clock.startedAt = null
      clock.eventIndex = currentIndex + 1
      clock.remainingMs = REPLAY_EVENT_DURATION_MS
      const nextIndex = currentIndex + 1
      if (nextIndex >= orderedEvents.length) {
        setPlaying(false)
        return
      }
      const event = orderedEvents[nextIndex]
      setPlaybackIndex(nextIndex)
      onSelectEvent(event)
      const node = modelRef.current?.nodes.find((candidate) => candidate.source === event)
      sceneRef.current?.setActiveNode(node?.id, true)
    }, clock.remainingMs / speed)
    return () => {
      window.clearTimeout(timer)
      if (clock.startedAt !== null) {
        clock.remainingMs = Math.max(0, clock.remainingMs - (performance.now() - clock.startedAt))
        clock.startedAt = null
      }
    }
  }, [playing, currentIndex, orderedEvents, onSelectEvent, speed])

  const selectEvent = (index: number, animate = false) => {
    const event = orderedEvents[index]
    if (!event) return
    setPlaybackIndex(index)
    onSelectEvent(event)
    const node = model?.nodes.find((candidate) => candidate.source === event)
    sceneRef.current?.setActiveNode(node?.id, animate)
  }

  const togglePlayback = () => {
    if (playing) {
      setPlaying(false)
      return
    }
    if (!orderedEvents.length) return
    if (currentIndex < 0 || currentIndex >= orderedEvents.length - 1) selectEvent(0, true)
    else {
      const event = orderedEvents[currentIndex]
      const node = model?.nodes.find((candidate) => candidate.source === event)
      sceneRef.current?.setActiveNode(node?.id, true)
    }
    setPlaying(true)
  }

  const handleBattleSelect = (battleId: string) => {
    const battle = battles.find((item) => item.id === battleId)
    if (battle) onSelectBattle(battle)
  }

  return <section className="admin3d-workspace" aria-labelledby="admin3d-title">
    <header className="admin3d-heading">
      <div>
        <span className="admin3d-kicker">战局记录 / 事件回放</span>
        <h2 id="admin3d-title">3D 战局回放</h2>
      </div>
      <div className="admin3d-heading-controls">
        <label className="admin3d-battle-select">
          <span>战局</span>
          <select aria-label="选择战局回放" value={selectedBattle?.id ?? ''} onChange={(event) => handleBattleSelect(event.target.value)}>
            <option value="">选择战局</option>
            {battles.map((battle) => <option value={battle.id} key={battle.id}>{battle.topic || battle.id}</option>)}
          </select>
        </label>
        <button type="button" className="admin3d-reset" title="回到全局拓扑视角" disabled={!model} onClick={() => sceneRef.current?.resetCamera()}>全局视角</button>
      </div>
    </header>

    {showFinalSummary && <section className={`admin3d-final-summary outcome-${finalStatus}`} role="status" aria-label="战局最终总结">
      <div className="admin3d-final-summary-heading">
        <h3>战局最终总结</h3>
        <strong>{statusLabels[finalStatus] ?? '终局状态待确认'}</strong>
      </div>
      <p>{finalSummary}</p>
    </section>}

    <div className="admin3d-replay-layout">
      <div className="admin3d-scene-column">
        <div className="admin3d-scene-frame">
          {selectedBattle && events.length
            ? <div className="admin3d-scene" ref={sceneContainerRef} />
            : <div className="admin3d-empty-state">
              <span className="admin3d-empty-mark" aria-hidden="true">3D</span>
              <strong>{selectedBattle ? '暂无事件，无法回放' : '选择一场战局开始回放'}</strong>
              {selectedBattle && <small>该战局当前没有可用的事件记录</small>}
            </div>}
          <div className="admin3d-legend" aria-label="事件状态图例">
            <span><i className="is-attacker" />攻击方轨迹</span>
            <span><i className="is-defender" />防守方轨迹</span>
            <span><i className="is-interaction" />队内关联 / 攻防交接</span>
            <span><i className="is-jump" />攻击跳板</span>
            <span><i className="is-asset" />防守内网</span>
            <span className="legend-status"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /></svg>正常守护</span>
            <span className="legend-status"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="6.5" cy="6.5" r="4" /><path d="m9.5 9.5 4.5 4.5" /></svg>正在被探测</span>
            <span className="legend-status"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2 14 13H2L8 2Z M8 6v3 M8 11v.2" /></svg>遭受攻击</span>
            <span className="legend-status"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8 M12 4l-8 8" /></svg>已沦陷</span>
            <span><i className="is-running" />进行中</span>
            <span><i className="is-completed" />已完成</span>
            <span><i className="is-failed" />失败</span>
            <span><i className="is-active" />当前事件</span>
          </div>
        </div>
        <div className="admin3d-transport">
          <button type="button" className="admin3d-play" disabled={!orderedEvents.length} onClick={togglePlayback}>
            {playing ? '暂停回放' : '播放回放'}
          </button>
          <label className="admin3d-speed">
            <span>速度</span>
            <select aria-label="回放速度" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
              <option value={0.25}>0.25×</option>
              <option value={0.5}>0.5×</option>
              <option value={1}>1×</option>
              <option value={2}>2×</option>
              <option value={4}>4×</option>
            </select>
          </label>
          <label className="admin3d-progress">
            <span className="sr-only">回放进度</span>
            <input
              aria-label="回放进度"
              type="range"
              min={0}
              max={Math.max(orderedEvents.length - 1, 0)}
              value={Math.max(currentIndex, 0)}
              disabled={!orderedEvents.length}
              onChange={(event) => selectEvent(Number(event.target.value))}
            />
            <span className="admin3d-progress-markers" aria-hidden="true">
              {orderedEvents.map((event, index) => {
                const cue = replayEventCue(event)
                const style = { left: `${orderedEvents.length < 2 ? 50 : index / (orderedEvents.length - 1) * 100}%`, '--marker-color': cue.color } as CSSProperties
                const showLabel = index === (currentIndex < 0 ? 0 : currentIndex)
                return <i key={`${event.sequence ?? index}-${index}`} data-testid="replay-event-marker" data-kind={cue.kind} style={style} title={cue.label}>
                  {showLabel && <span className="admin3d-progress-marker-label">{cue.label}</span>}
                </i>
              })}
            </span>
          </label>
          <span className="admin3d-progress-count">{currentIndex < 0 ? 0 : currentIndex + 1} / {orderedEvents.length}</span>
        </div>
        {hasMoreEvents && <button type="button" className="admin3d-load-more" disabled={loadingMoreEvents} onClick={onLoadMoreEvents}>{loadingMoreEvents ? '正在加载事件…' : `加载更多事件（${orderedEvents.length} / ${eventsTotal}）`}</button>}
      </div>

      <aside className="admin3d-event-panel" aria-live="polite">
        <div className="admin3d-event-heading">
          <span>当前事件</span>
          {currentEvent?.status && <strong className={`status-${currentEvent.status}`}>{statusLabels[currentEvent.status] ?? currentEvent.status}</strong>}
        </div>
        {selectedBattle && <p className="admin3d-battle-meta">{selectedBattle.topic || selectedBattle.id}<br /><small>{selectedBattle.id}</small></p>}
        {currentEvent ? <>
          <div className={`admin3d-event-flow actor-${eventActorRole(currentEvent)}`}>
            <span>{eventActorLabel(eventActorRole(currentEvent))}</span>
            <strong>{eventFlowLabel(currentEvent, orderedEvents[currentIndex - 1], orderedEvents[currentIndex + 1])}</strong>
          </div>
          <h3>{eventLabel(currentEvent)}</h3>
          <p className="admin3d-event-meta">序号 {currentEvent.sequence ?? currentIndex + 1} · {currentEvent.timestamp || '未记录时间'}</p>
          {typeof currentEvent.data?.round === 'number' && <p className="admin3d-round-marker">第 {currentEvent.data.round} / {expectedRounds[selectedBattle?.difficulty ?? ''] ?? '—'} 轮</p>}
          {currentEvent !== finalEvent && replayEventSummary(currentEvent, orderedEvents) && <p className="admin3d-event-summary" role="status">{replayEventSummary(currentEvent, orderedEvents)}</p>}
          <pre>{eventDetails(currentEvent)}</pre>
        </> : <p className="admin3d-muted">播放或拖动进度后显示对应记录。</p>}
      </aside>
    </div>

    <div className="admin3d-statusline" aria-live="polite">
      <span><i className={`status-dot status-${selectedBattle?.status ?? 'unknown'}`} />{selectedBattle ? statusLabels[selectedBattle.status] ?? selectedBattle.status : '未选择战局'}</span>
      <span>{selectedBattle ? `战局：${selectedBattle.topic || selectedBattle.id}` : '尚未开始'}</span>
      <span>{orderedEvents.length} / {eventsTotal} 条记录</span>
    </div>
  </section>
}

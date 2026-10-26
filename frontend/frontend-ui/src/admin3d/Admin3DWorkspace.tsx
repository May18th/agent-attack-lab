import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { AdminBattle, AdminBattleEvent, AdminBattleScore } from '../adminApi'
import type { ExternalCase } from '../api'
import { ThreeScene } from './ThreeScene'
import { buildBattleTimelineSceneModel, eventActorLabel, eventActorRole, eventFlowLabel, replayEventCue, replayEventSummary, securityPathTheme, type AdminSceneNode } from './sceneModel'
import { NodeDetailsPanel } from './NodeDetailsPanel'

const REPLAY_EVENT_DURATION_MS = 2500
import './Admin3DWorkspace.css'

type Admin3DWorkspaceProps = {
  battles: AdminBattle[]
  selectedBattle: AdminBattle | null
  events: AdminBattleEvent[]
  eventsTotal?: number
  hasMoreEvents?: boolean
  onLoadMoreEvents?: () => void
  selectedEvent: AdminBattleEvent | null
  score?: AdminBattleScore | null
  externalCases?: ExternalCase[]
  /** Search text from the 2D event timeline; the 3D scene mirrors this filter. */
  eventQuery?: string
  onSelectBattle: (battle: AdminBattle) => void
  onSelectEvent: (event: AdminBattleEvent) => void
}

const statusLabels: Record<string, string> = {
  pending: '等待中', running: '进行中', completed: '已完成', failed: '失败',
  attacker_won: '目标已由真实证据验证', defender_won: '防守成功', undetermined: '结果未判定',
}


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

function eventEvidenceItems(event: AdminBattleEvent): Array<{ label: string; value: string }> {
  const data = event.data ?? {}
  const items: Array<{ label: string; value: string }> = []
  if (typeof data.round === 'number') items.push({ label: '回合', value: `第 ${data.round} 轮` })
  if (typeof data.agentSource === 'string') items.push({ label: '调用来源', value: data.agentSource })
  if (typeof data.verificationMode === 'string') items.push({ label: '验证模式', value: data.verificationMode === 'simulated' ? '规则推定' : data.verificationMode === 'live' ? '真实目标验证' : data.verificationMode })
  if (typeof data.targetVerified === 'boolean') items.push({ label: '目标验证', value: data.targetVerified ? (data.simulated === true ? '规则推定，目标未验证' : '已验证') : '未提供验证证据' })
  if (Array.isArray(data.caught)) items.push({ label: '命中', value: `${data.caught.length} 项` })
  if (Array.isArray(data.risks)) items.push({ label: '风险', value: `${data.risks.length} 项` })
  if (Array.isArray(data.fixed)) items.push({ label: '建议', value: `${data.fixed.length} 项` })
  if (typeof data.error === 'string') items.push({ label: '失败原因', value: data.error })
  return items
}

function eventSummaryText(event: AdminBattleEvent, events: AdminBattleEvent[]): string {
  return replayEventSummary(event, events) ?? '该事件没有可展示的结构化摘要，请查看原始数据。'
}

export function Admin3DWorkspace(props: Admin3DWorkspaceProps) {
  return <Admin3DReplay key={props.selectedBattle?.id ?? 'no-battle'} {...props} />
}

function Admin3DReplay({ battles, selectedBattle, events, eventsTotal = events.length, hasMoreEvents = false, onLoadMoreEvents, selectedEvent, score, eventQuery = '', externalCases = [], onSelectBattle, onSelectEvent }: Admin3DWorkspaceProps) {
  const [playbackIndex, setPlaybackIndex] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [selectedNode, setSelectedNode] = useState<AdminSceneNode | null>(null)
  const [sceneError, setSceneError] = useState('')
  const [sceneAttempt, setSceneAttempt] = useState(0)
  const [show2DFallback, setShow2DFallback] = useState(false)
  const [rawEvent, setRawEvent] = useState<AdminBattleEvent | null>(null)
  const sceneContainerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<ThreeScene | null>(null)
  const replayClock = useRef({ eventIndex: -2, remainingMs: REPLAY_EVENT_DURATION_MS, startedAt: null as number | null })
  const model = useMemo(
    () => selectedBattle && events.length ? buildBattleTimelineSceneModel(selectedBattle, events, externalCases, score) : null,
    [selectedBattle, events, externalCases, score],
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
  const activeSecurityTheme = securityPathTheme(selectedBattle?.topic)
  const selectedEventIndex = selectedEvent ? orderedEvents.indexOf(selectedEvent) : -1
  const currentIndex = selectedEventIndex >= 0 ? selectedEventIndex : playbackIndex
  // 有事件时默认展示第一条，但不改变播放索引，保证点击播放仍会从第一条开始。
  const displayIndex = currentIndex >= 0 ? currentIndex : orderedEvents.length ? 0 : -1
  const currentEvent = displayIndex >= 0 ? orderedEvents[displayIndex] : undefined
  const finalEvent = [...orderedEvents].reverse().find((event) => {
    const type = String(event.eventType ?? event.type ?? '')
    return type === 'battle.completed' || type === 'battle.failed'
  })
  const showFinalSummary = Boolean(finalEvent || selectedBattle?.status === 'completed' || selectedBattle?.status === 'failed')
  const finalEventData = (finalEvent?.data ?? {}) as Record<string, unknown>
  const compromiseEvents = orderedEvents.filter((event) => String(event.eventType ?? event.type ?? '') === 'attack.compromised' && event.data?.targetVerified === true)
  const recordedVerdict = finalEventData.verdict ?? selectedBattle?.verdict
  const hasLiveCompromiseEvidence = compromiseEvents.some((event) => event.data?.simulated !== true)
  const finalVerdict = recordedVerdict === 'attacker_won' && hasLiveCompromiseEvidence
    ? 'attacker_won'
    : recordedVerdict === 'defender_won' ? 'defender_won'
      : recordedVerdict === 'undetermined' ? 'undetermined'
        : selectedBattle?.status === 'completed' || String(finalEvent?.eventType ?? finalEvent?.type ?? '') === 'battle.completed' ? 'undetermined' : undefined
  const finalSummaryBase = finalEvent
    ? replayEventSummary(finalEvent, orderedEvents)
    : selectedBattle?.status === 'failed'
      ? '战局已失败，但记录中缺少终局事件，无法确定中断原因。'
      : '战局已完成，但记录中缺少终局事件，无法汇总逐轮证据。真实目标验证状态无法确认。'
  const interceptedRounds = typeof finalEventData.interceptedRounds === 'number'
    ? finalEventData.interceptedRounds
    : orderedEvents.filter((event) => String(event.eventType ?? event.type ?? '') === 'round.completed'
      && event.data?.attackSuccess === false
      && event.data?.defenseSuccess === true).length
  const compromisedRounds = typeof finalEventData.compromisedRounds === 'number' ? finalEventData.compromisedRounds : compromiseEvents.length
  const verificationMode = finalEventData.verificationMode ?? compromiseEvents[0]?.data?.verificationMode
  const verdictSummary = finalVerdict === 'attacker_won'
    ? `目标沦陷：${verificationMode === 'simulated' || compromiseEvents.some((event) => event.data?.simulated === true) ? '规则推定，真实目标未验证' : '已有验证证据'}；沦陷 ${compromisedRounds} 轮，防守拦截 ${interceptedRounds} 轮。`
    : finalVerdict === 'defender_won'
      ? `防守成功：检测到拦截证据且没有已验证沦陷；拦截 ${interceptedRounds} 轮。`
      : finalVerdict === 'undetermined'
        ? '结果未判定：验证未启用或证据不足；不能把流程完成或样本穿透等同于目标沦陷。'
        : ''
  const finalSummary = [finalSummaryBase, verdictSummary].filter(Boolean).join(' ')
  const finalStatus = finalEvent
    ? String(finalEvent.eventType ?? finalEvent.type ?? '') === 'battle.failed' ? 'failed' : finalVerdict ?? 'completed'
    : selectedBattle?.status === 'completed' ? finalVerdict ?? 'undetermined' : selectedBattle?.status ?? 'unknown'

  useLayoutEffect(() => {
    modelRef.current = model
    eventsRef.current = orderedEvents
    selectEventRef.current = onSelectEvent
  }, [model, orderedEvents, onSelectEvent])

  useEffect(() => {
    const container = sceneContainerRef.current
    const initialModel = modelRef.current
    if (!container || !selectedBattleId || !initialModel || show2DFallback) return
    const scene = new ThreeScene()
    sceneRef.current = scene
    setSceneError('')
    let sceneReady = false
    try {
      scene.mount(container, initialModel, {
        onSelectNode: (node) => {
          setSelectedNode(node)
          if (node.kind !== 'timeline-event' || !node.source || typeof node.source !== 'object') return
          const event = node.source as AdminBattleEvent
          const index = eventsRef.current.indexOf(event)
          if (index >= 0) {
            setPlaybackIndex(index)
            selectEventRef.current(event)
          }
        },
      })
      sceneReady = true
    } catch (error) {
      const message = error instanceof Error ? error.message : '3D 回放暂不可用'
      setSceneError(message)
      sceneRef.current = null
      scene.dispose()
    }
    const observer = sceneReady && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => scene.resize()) : undefined
    observer?.observe(container)
    return () => {
      observer?.disconnect()
      if (sceneReady) scene.dispose()
      sceneRef.current = null
    }
  }, [selectedBattleId, hasModel, sceneAttempt, show2DFallback])

  useLayoutEffect(() => { if (model) sceneRef.current?.update(model) }, [model])

  useEffect(() => {
    const query = eventQuery.trim()
    sceneRef.current?.setNodeQuery(query)
    if (!query || !model) return
    const normalized = query.toLocaleLowerCase()
    const match = orderedEvents.find((event) => JSON.stringify(event).toLocaleLowerCase().includes(normalized))
    if (!match) return
    if (selectedEvent !== match) onSelectEvent(match)
    const node = model.nodes.find((candidate) => candidate.source === match)
    if (node) sceneRef.current?.setActiveNode(node.id)
  }, [eventQuery, model, orderedEvents, onSelectEvent, selectedEvent])

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
      clock.remainingMs = REPLAY_EVENT_DURATION_MS / Math.max(speed, 0.01)
    }
    clock.startedAt = performance.now()
    const timer = window.setTimeout(() => {
      clock.startedAt = null
      clock.eventIndex = currentIndex + 1
      clock.remainingMs = REPLAY_EVENT_DURATION_MS / Math.max(speed, 0.01)
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
    }, clock.remainingMs)
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
    setRawEvent(null)
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

  useEffect(() => {
    if (rawEvent && rawEvent !== currentEvent) setRawEvent(null)
  }, [currentEvent, rawEvent])

  const handleBattleSelect = (battleId: string) => {
    const battle = battles.find((item) => item.id === battleId)
    if (battle) onSelectBattle(battle)
  }

  const sceneFallback = sceneError || show2DFallback
  const sceneFallbackLabel = sceneError ? '3D 工作台不可用，已保留 2D 事件回放。' : '已切换到 2D 事件回放。'

  return <section className="admin3d-workspace" aria-labelledby="admin3d-title">
    <header className="admin3d-heading">
      <div>
        <span className="admin3d-kicker">事件时间线</span>
        <h2 id="admin3d-title">战局回放</h2>
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
        <button type="button" className="admin3d-reset" title="解除当前节点的视角锁定，也可在场景中点击鼠标右键" disabled={!model} onClick={() => sceneRef.current?.unlockView()}>取消视角锁定</button>
        <button type="button" className="admin3d-reset" title="恢复初始攻击路径" disabled={!model} onClick={() => sceneRef.current?.resetSecurityPath()}>重置路径</button>
        {model && !sceneFallback && <button type="button" className="admin3d-reset" onClick={() => setShow2DFallback(true)}>切换到 2D 时间线</button>}
        {sceneFallback && <button type="button" className="admin3d-reset" onClick={() => { setShow2DFallback(false); setSceneError(''); setSceneAttempt((attempt) => attempt + 1) }}>重新加载 3D</button>}
      </div>
    </header>

    {showFinalSummary && <section className={`admin3d-final-summary outcome-${finalStatus.replace('_', '-')}`} role="status" aria-label="战局最终总结">
      <div className="admin3d-final-summary-heading">
        <h3>战局最终总结</h3>
        <strong>{statusLabels[finalStatus] ?? '终局状态待确认'}</strong>
      </div>
      <p>{finalSummary}</p>
    </section>}

    <div className="admin3d-replay-layout">
      <div className="admin3d-scene-column">
        <div className={`admin3d-scene-frame${selectedBattle && events.length ? '' : ' is-empty'}${sceneFallback ? ' is-fallback' : ''}`}>
          {selectedBattle && events.length
            ? sceneFallback
              ? <div className="admin3d-scene-fallback">
                <div className="admin3d-scene-fallback-head" role="status">
                  <strong>{sceneFallbackLabel}</strong>
                  {sceneError && <small>{sceneError}</small>}
                </div>
                <ol className="admin3d-fallback-events" aria-label="2D 事件时间线">
                  {orderedEvents.map((event, index) => {
                    const cue = replayEventCue(event)
                    const active = index === displayIndex
                    return <li key={`${event.sequence ?? index}-${index}`}>
                      <button type="button" className={active ? 'is-active' : ''} aria-current={active ? 'step' : undefined} onClick={() => selectEvent(index)}>
                        <span className="admin3d-fallback-event-index">{event.sequence ?? index + 1}</span>
                        <span className="admin3d-fallback-event-copy"><strong>{eventLabel(event)}</strong><small>{cue.label} · {event.timestamp || '未记录时间'}</small></span>
                        {active && <span className="admin3d-fallback-current">当前</span>}
                      </button>
                    </li>
                  })}
                </ol>
                {hasMoreEvents && <button type="button" className="admin3d-load-more" onClick={onLoadMoreEvents}>加载更多事件（{orderedEvents.length} / {eventsTotal}）</button>}
                {!show2DFallback && <button type="button" className="admin3d-fallback-retry" onClick={() => setSceneAttempt((attempt) => attempt + 1)}>重新尝试加载 3D</button>}
              </div>
              : <div className="admin3d-scene" ref={sceneContainerRef} />
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
          {selectedBattle && <div className="admin3d-security-theme" aria-label="当前主题防护路径">
            <span>{activeSecurityTheme.name}</span>
            <strong>重点防护层：第 {activeSecurityTheme.focusedLayers.join('、')} 层</strong>
            <small>拦截统计：后端防守结果推导；缺失时显示未记录</small>
          </div>}
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
              value={Math.max(displayIndex, 0)}
              disabled={!orderedEvents.length}
              onChange={(event) => selectEvent(Number(event.target.value))}
            />
            <span className="admin3d-progress-markers" aria-hidden="true">
              {orderedEvents.map((event, index) => {
                const cue = replayEventCue(event)
                const style = { left: `${orderedEvents.length < 2 ? 50 : index / (orderedEvents.length - 1) * 100}%`, '--marker-color': cue.color } as CSSProperties
                const showLabel = index === (displayIndex < 0 ? 0 : displayIndex)
                return <i key={`${event.sequence ?? index}-${index}`} data-testid="replay-event-marker" data-kind={cue.kind} style={style} title={cue.label}>
                  {showLabel && <span className="admin3d-progress-marker-label">{cue.label}</span>}
                </i>
              })}
            </span>
          </label>
          <span className="admin3d-progress-count">{displayIndex < 0 ? 0 : displayIndex + 1} / {orderedEvents.length}</span>
        </div>
        {hasMoreEvents && <button type="button" className="admin3d-load-more" onClick={onLoadMoreEvents}>加载更多事件（{orderedEvents.length} / {eventsTotal}）</button>}
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
            <strong>{eventFlowLabel(currentEvent, orderedEvents[displayIndex - 1], orderedEvents[displayIndex + 1])}</strong>
          </div>
          <h3>{eventLabel(currentEvent)}</h3>
          <p className="admin3d-event-meta">序号 {currentEvent.sequence ?? displayIndex + 1} · {currentEvent.timestamp || '未记录时间'}</p>
          {typeof currentEvent.data?.round === 'number' && <p className="admin3d-round-marker">第 {currentEvent.data.round} / {selectedBattle?.rounds ?? 3} 轮</p>}
          {currentEvent !== finalEvent && <p className="admin3d-event-summary" role="status">{eventSummaryText(currentEvent, orderedEvents)}</p>}
          {eventEvidenceItems(currentEvent).length > 0 && <dl className="admin3d-event-evidence" aria-label="事件关键证据">
            {eventEvidenceItems(currentEvent).map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
          </dl>}
          <details key={`raw-${currentEvent.sequence ?? displayIndex}`} className="admin3d-event-raw" open={rawEvent === currentEvent} onToggle={(event) => setRawEvent(event.currentTarget.open ? currentEvent : null)}>
            <summary>查看原始事件数据</summary>
            <pre>{eventDetails(currentEvent)}</pre>
          </details>
        </> : <p className="admin3d-muted">播放或拖动进度后显示对应记录。</p>}
      </aside>
      <NodeDetailsPanel node={selectedNode} score={score} />
    </div>

    <div className="admin3d-statusline" aria-live="polite">
      <span><i className={`status-dot status-${selectedBattle?.status ?? 'unknown'}`} />{selectedBattle ? statusLabels[selectedBattle.status] ?? selectedBattle.status : '未选择战局'}</span>
      <span>{selectedBattle ? `战局：${selectedBattle.topic || selectedBattle.id}` : '尚未开始'}</span>
      <span>{orderedEvents.length} / {eventsTotal} 条记录</span>
    </div>
  </section>
}

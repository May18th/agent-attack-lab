import { useEffect, useMemo, useRef, useState } from 'react'
import type { AdminBattle, AdminBattleEvent } from '../adminApi'
import type { ThreeScene } from './ThreeScene'
import { buildBattleTimelineSceneModel } from './sceneModel'
import './BattleTimeline3D.css'

type BattleTimeline3DProps = {
  battle: AdminBattle
  events: AdminBattleEvent[]
  audit: Record<string, unknown>
  onSelectEvent: (event: AdminBattleEvent) => void
}

function eventLabel(event: AdminBattleEvent): string {
  return String(event.eventType ?? event.type ?? event.status ?? '战局事件')
}

function jsonPreview(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2)
}

function BattleTimeline3DView({ battle, events, audit, onSelectEvent }: BattleTimeline3DProps) {
  const [selectedEvent, setSelectedEvent] = useState<AdminBattleEvent | null>(null)
  const sceneContainerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<ThreeScene | null>(null)
  const initialModelRef = useRef(buildBattleTimelineSceneModel(battle, events))
  const sceneModel = useMemo(() => buildBattleTimelineSceneModel(battle, events), [battle, events])
  const orderedEvents = useMemo(() => events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => (left.event.sequence ?? Number.MAX_SAFE_INTEGER) - (right.event.sequence ?? Number.MAX_SAFE_INTEGER) || left.index - right.index)
    .map(({ event }) => event), [events])

  useEffect(() => {
    const container = sceneContainerRef.current
    if (!container) return
    let disposed = false
    let scene: ThreeScene | undefined
    const showError = (error: unknown) => {
      if (disposed) return
      const fallback = document.createElement('div')
      fallback.className = 'battle-timeline-scene-error'
      fallback.setAttribute('role', 'status')
      fallback.textContent = error instanceof Error ? error.message : '3D 事件轨迹暂不可用'
      container.appendChild(fallback)
    }
    void import('./ThreeScene').then(({ ThreeScene: SceneRenderer }) => {
      if (disposed) return
      scene = new SceneRenderer()
      sceneRef.current = scene
      try {
        scene.mount(container, initialModelRef.current, {
          onSelectNode: (node) => {
            if (node.kind !== 'timeline-event' || !node.source || typeof node.source !== 'object') return
            const event = node.source as AdminBattleEvent
            setSelectedEvent(event)
            onSelectEvent(event)
          },
        })
      } catch (error) { showError(error) }
    }).catch(showError)
    return () => { disposed = true; scene?.dispose(); sceneRef.current = null }
  }, [onSelectEvent])

  useEffect(() => { sceneRef.current?.update(sceneModel) }, [sceneModel])

  const selectEvent = (event: AdminBattleEvent) => { setSelectedEvent(event); onSelectEvent(event) }

  return <section className="battle-timeline" aria-label={`${battle.topic || battle.id}战局时间线`}>
    <header className="battle-timeline-heading">
      <div><h3>战局时间线</h3><p>{battle.topic || battle.id} · {battle.id} · {battle.status}</p></div>
      <span>{orderedEvents.length} 条事件</span>
    </header>
    <div className="battle-timeline-scene-frame" role="region" aria-label="3D 战局事件轨迹">
      <div className="battle-timeline-scene" ref={sceneContainerRef} />
    </div>
    {orderedEvents.length ? <ol className="battle-timeline-track" aria-label="战局事件轨迹">
      {orderedEvents.map((event, index) => {
        const sequence = event.sequence ?? index + 1
        const isSelected = selectedEvent === event
        return <li className="battle-timeline-point" key={`${sequence}-${index}`}>
          <button type="button" aria-label={`第 ${sequence} 条事件：${eventLabel(event)}`} aria-pressed={isSelected} onClick={() => selectEvent(event)}>
            <span className="battle-timeline-sequence">{sequence}</span>
            <span className="battle-timeline-event">
              <strong>{eventLabel(event)}</strong>
              <small>{event.timestamp || event.status || '时间未提供'}</small>
              <code>{jsonPreview(event)}</code>
            </span>
          </button>
        </li>
      })}
    </ol> : <p className="battle-timeline-empty">本场暂无事件</p>}
    {selectedEvent && <p className="battle-timeline-selection" role="status">已选事件：{selectedEvent.sequence ?? '—'} · {eventLabel(selectedEvent)}</p>}
    <details className="battle-timeline-audit" open>
      <summary>审计层</summary>
      {Object.keys(audit).length ? <dl>{Object.entries(audit).map(([key, value]) => <div key={key}><dt>{key}</dt><dd><pre>{jsonPreview(value)}</pre></dd></div>)}</dl> : <p className="battle-timeline-empty">暂无审计数据</p>}
    </details>
  </section>
}

export function BattleTimeline3D(props: BattleTimeline3DProps) {
  return <BattleTimeline3DView key={props.battle.id} {...props} />
}

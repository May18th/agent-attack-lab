import { useMemo, useState } from 'react'
import type { AdminBattle, AdminBattleEvent } from '../adminApi'
import './BattleTimeline3D.css'

type BattleTimeline3DProps = {
  battle: AdminBattle
  events: AdminBattleEvent[]
  audit: Record<string, unknown>
  eventsTotal?: number
  hasMoreEvents?: boolean
  loadingMoreEvents?: boolean
  onLoadMoreEvents?: () => void
  selectedEvent: AdminBattleEvent | null
  onSelectEvent: (event: AdminBattleEvent) => void
}

function eventLabel(event: AdminBattleEvent): string {
  return String(event.eventType ?? event.type ?? event.status ?? '战局事件')
}

function jsonPreview(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2)
}

export function BattleTimeline3D({ battle, events, audit, eventsTotal = events.length, hasMoreEvents = false, loadingMoreEvents = false, onLoadMoreEvents, selectedEvent, onSelectEvent }: BattleTimeline3DProps) {
  const [query, setQuery] = useState('')
  const orderedEvents = useMemo(() => events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => (left.event.sequence ?? Number.MAX_SAFE_INTEGER) - (right.event.sequence ?? Number.MAX_SAFE_INTEGER) || left.index - right.index)
    .map(({ event }) => event), [events])
  const filteredEvents = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    if (!normalizedQuery) return orderedEvents
    return orderedEvents.filter((event) => jsonPreview(event).toLocaleLowerCase().includes(normalizedQuery))
  }, [orderedEvents, query])

  const exportEvents = () => {
    const content = JSON.stringify({ battleId: battle.id, exportedAt: new Date().toISOString(), complete: !hasMoreEvents, events: orderedEvents }, null, 2)
    const objectUrl = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = `${battle.id}-events.json`
    anchor.click()
    URL.revokeObjectURL(objectUrl)
  }

  return <section className="battle-timeline" aria-label={`${battle.topic || battle.id}战局记录`}>
    <header className="battle-timeline-heading">
      <div><h3>事件记录</h3><p>{battle.topic || battle.id} · {battle.id}</p></div>
      <span>{filteredEvents.length === orderedEvents.length ? `${orderedEvents.length} 条` : `${filteredEvents.length} / ${orderedEvents.length} 条`}</span>
    </header>
    <div className="battle-timeline-tools">
      <label className="battle-timeline-search">
        <span>搜索</span>
        <input aria-label="搜索事件记录" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="类型、序号或事件内容" />
      </label>
      <button className="battle-timeline-export" type="button" onClick={exportEvents} disabled={!orderedEvents.length}>{hasMoreEvents ? '导出已加载事件' : '导出事件'}</button>
    </div>
    {filteredEvents.length ? <ol className="battle-timeline-track" aria-label="战局事件列表">
      {filteredEvents.map((event, index) => {
        const sequence = event.sequence ?? index + 1
        const isSelected = selectedEvent === event || (selectedEvent?.sequence != null && selectedEvent.sequence === event.sequence)
        return <li className="battle-timeline-point" key={`${sequence}-${index}`}>
          <button type="button" aria-label={`第 ${sequence} 条事件：${eventLabel(event)}`} aria-pressed={isSelected} onClick={() => onSelectEvent(event)}>
            <span className="battle-timeline-sequence">{sequence}</span>
            <span className="battle-timeline-event">
              <strong>{eventLabel(event)}</strong>
              <small>{event.timestamp || event.status || '时间未提供'}</small>
              {event.status && <small className={`battle-timeline-status status-${event.status}`}>{event.status}</small>}
            </span>
          </button>
        </li>
      })}
    </ol> : <p className="battle-timeline-empty">{orderedEvents.length ? '没有匹配的事件' : '本场暂无事件'}</p>}
    {hasMoreEvents && <button className="battle-timeline-load-more" type="button" disabled={loadingMoreEvents} onClick={onLoadMoreEvents}>{loadingMoreEvents ? '正在加载事件…' : `加载更多事件（${events.length} / ${eventsTotal}）`}</button>}
    {selectedEvent && <details className="battle-timeline-selection" open>
      <summary>事件详情：{selectedEvent.sequence ?? '—'} · {eventLabel(selectedEvent)}</summary>
      <pre>{jsonPreview(selectedEvent)}</pre>
    </details>}
    <details className="battle-timeline-audit">
      <summary>审计记录</summary>
      {Object.keys(audit).length ? <dl>{Object.entries(audit).map(([key, value]) => <div key={key}><dt>{key}</dt><dd><pre>{jsonPreview(value)}</pre></dd></div>)}</dl> : <p className="battle-timeline-empty">暂无审计数据</p>}
    </details>
  </section>
}

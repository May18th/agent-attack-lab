import { useEffect, useMemo, useState } from 'react'
import type { AdminBattle, AdminBattleEvent, AdminBattleScore } from '../adminApi'
import './BattleTimeline3D.css'

type BattleTimeline3DProps = {
  battle: AdminBattle
  events: AdminBattleEvent[]
  audit: Record<string, unknown>
  /** Backend score response. Undefined means the caller has not loaded it yet; null means the API returned no score. */
  score?: AdminBattleScore | null
  eventsTotal?: number
  hasMoreEvents?: boolean
  onLoadMoreEvents?: () => void
  onSearchQueryChange?: (query: string) => void
  selectedEvent: AdminBattleEvent | null
  onSelectEvent: (event: AdminBattleEvent) => void
}

function eventLabel(event: AdminBattleEvent): string {
  return String(event.eventType ?? event.type ?? event.status ?? '战局事件')
}

function jsonPreview(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2)
}

function scoreStatusLabel(status?: string): string {
  if (status === 'completed') return '已完成'
  if (status === 'pending') return '计算中'
  if (status === 'failed') return '计算失败'
  return status || '未知'
}

function formatRoleScore(score: AdminBattleScore['attacker'] | undefined): string {
  if (!score || typeof score.score !== 'number') return '暂不可用'
  return `${score.score}/${score.maxScore}`
}

function markdownReport(
  battle: AdminBattle,
  events: AdminBattleEvent[],
  audit: Record<string, unknown>,
  score: AdminBattleScore | null | undefined,
  complete: boolean,
): string {
  const eventLines = events.length
    ? events.map((event, index) => `- #${event.sequence ?? index + 1} ${String(event.eventType ?? event.type ?? event.status ?? '战局事件')}${event.timestamp ? ` — ${event.timestamp}` : ''}`).join('\n')
    : '- 暂无事件记录'
  const scoreLines = score
    ? `- 评分状态：${scoreStatusLabel(score.status)}\n- 攻击方评分：${formatRoleScore(score.attacker)}\n- 防守方评分：${formatRoleScore(score.defender)}`
    : '- 评分：暂不可用（后端未返回评分）'
  return [
    `# 攻防实验室战局报告：${battle.id}`,
    '',
    `- 主题：${battle.topic || '未命名战局'}`,
    `- 难度：${battle.difficulty}`,
    `- 状态：${battle.status}`,
    `- 创建时间：${battle.createdAt}`,
    `- 事件数据：${complete ? '完整' : '部分加载'}`,
    '',
    '## 评分',
    scoreLines,
    '',
    '## 事件证据',
    eventLines,
    '',
    '## 审计记录',
    '```json',
    JSON.stringify(audit ?? {}, null, 2),
    '```',
    '',
  ].join('\n')
}

export function BattleTimeline3D({ battle, events, audit, score, eventsTotal = events.length, hasMoreEvents = false, onLoadMoreEvents, onSearchQueryChange, selectedEvent, onSelectEvent }: BattleTimeline3DProps) {
  const [query, setQuery] = useState('')
  useEffect(() => {
    // The input is intentionally local state: clear stale filters when a different battle is selected.
    // oxlint-disable-next-line react/set-state-in-effect
    setQuery('')
    onSearchQueryChange?.('')
  }, [battle.id, onSearchQueryChange])
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

  const exportMarkdown = () => {
    const content = markdownReport(battle, orderedEvents, audit, score, !hasMoreEvents)
    const objectUrl = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = `${battle.id}-report.md`
    anchor.click()
    URL.revokeObjectURL(objectUrl)
  }

  const riskLabel = battle.status === 'failed' ? '高风险：战局失败' : battle.difficulty === 'high' ? '高风险：高难度战局' : undefined

  return <section className="battle-timeline" aria-label={`${battle.topic || battle.id}战局记录`}>
    <header className="battle-timeline-heading">
      <div><h3>事件记录</h3><p>{battle.topic || battle.id} · {battle.id}</p></div>
      <div className="battle-timeline-heading-meta">
        {riskLabel && <strong className="battle-timeline-risk" role="status" aria-label={riskLabel}>{riskLabel}</strong>}
        <span>{filteredEvents.length === orderedEvents.length ? `${orderedEvents.length} 条` : `${filteredEvents.length} / ${orderedEvents.length} 条`}</span>
      </div>
    </header>
    {score !== undefined && <section className="battle-timeline-score" aria-label="战局评分">
      <div className="battle-timeline-score-heading"><strong>战局评分</strong><span>评分状态：{score ? scoreStatusLabel(score.status) : '暂不可用'}</span></div>
      {score ? <div className="battle-timeline-score-grid">
        <span>攻击方 <strong>{formatRoleScore(score.attacker)}</strong></span>
        <span>防守方 <strong>{formatRoleScore(score.defender)}</strong></span>
      </div> : <p>评分暂不可用，未使用前端估算值。</p>}
    </section>}
    <div className="battle-timeline-tools">
      <label className="battle-timeline-search">
        <span>搜索</span>
        <input aria-label="搜索事件记录" type="search" value={query} onChange={(event) => { const value = event.target.value; setQuery(value); onSearchQueryChange?.(value) }} placeholder="类型、序号或事件内容" />
      </label>
      <div className="battle-timeline-export-actions">
        <button className="battle-timeline-export" type="button" onClick={exportEvents} disabled={!orderedEvents.length}>{hasMoreEvents ? '导出已加载事件' : '导出事件'}</button>
        <button className="battle-timeline-export" type="button" onClick={exportMarkdown} disabled={!orderedEvents.length && !score}>导出 Markdown 报告</button>
      </div>
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
    {hasMoreEvents && <button className="battle-timeline-load-more" type="button" onClick={onLoadMoreEvents}>加载更多事件（{events.length} / {eventsTotal}）</button>}
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

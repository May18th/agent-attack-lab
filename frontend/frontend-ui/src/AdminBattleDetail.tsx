import { useMemo, useState } from 'react'
import type { AdminBattle, AdminBattleEvent, AdminBattleRounds, AdminBattleScore } from './adminApi'
import {
  AUDIT_ISSUE_LABELS, DIFFICULTY_LABELS, SEVERITY_LABELS, STATUS_LABELS, VERDICT_LABELS,
  VERIFICATION_MODE_LABELS, eventLabel, formatClock, formatDuration, formatNumber, labelOf,
} from './adminLabels'

type Props = {
  battle: AdminBattle
  rounds: AdminBattleRounds | null
  score?: AdminBattleScore | null
  events: AdminBattleEvent[]
  audit?: Record<string, unknown>
  detailData: Record<string, unknown>
  showRawData?: boolean
  hasMoreEvents: boolean
  onLoadMoreEvents: () => void
  selectedEvent: AdminBattleEvent | null
  onSelectEvent: (event: AdminBattleEvent) => void
}

type Tone = 'green' | 'red' | 'orange' | 'gray'
type Outcome = { label: string; tone: Tone }

const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? value as T[] : [])
const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {})
const eventType = (event: AdminBattleEvent) => String(event.eventType ?? event.type ?? '')
const eventData = (event?: AdminBattleEvent) => asRecord(event?.data)

function arbiterOutcome(round: AdminBattleRounds['rounds'][number]): Outcome | null {
  const review = round.arbiterReview
  const verdict = typeof review?.verdict === 'string' ? review.verdict : ''
  if (!verdict) return null
  const tone: Tone = verdict === 'attacker_won' ? 'red' : verdict === 'defender_won' ? 'green' : 'gray'
  const base = labelOf(verdict, VERDICT_LABELS)
  return { label: review?.needsHumanReview ? `${base} · 需复核` : base, tone }
}

function verdictLabel(verdict: string | undefined, verificationMode?: string): string {
  if (verdict === 'attacker_won' && verificationMode === 'simulated') return '规则命中推定（真实目标未验证）'
  return labelOf(verdict, VERDICT_LABELS)
}

function arbiterTitle(round: AdminBattleRounds['rounds'][number]): string {
  const review = round.arbiterReview
  if (!review) return ''
  return [review.rationale, review.agentSource ? `来源 ${review.agentSource}` : ''].filter(Boolean).join(' · ')
}

function roundOutcome(round: AdminBattleRounds['rounds'][number]): Outcome {
  if (round.compromised?.targetVerified) {
    return round.compromised.simulated
      ? { label: '穿透（规则推定，目标未验证）', tone: 'orange' }
      : { label: '已沦陷（已验证）', tone: 'red' }
  }
  if (asArray(round.caught).length > 0) return { label: '已拦截', tone: 'green' }
  if (round.status && round.status !== 'completed') {
    return { label: labelOf(round.status, STATUS_LABELS), tone: 'gray' }
  }
  return { label: '穿透（未命中规则、无验证）', tone: 'orange' }
}

function eventSummary(event: AdminBattleEvent): string {
  const data = eventData(event)
  const round = typeof data.round === 'number' ? `第 ${data.round} 轮` : ''
  const type = eventType(event)
  if (type === 'attack.sample.generated') {
    const sample = asRecord(data.sample)
    const parts = [round, String(sample.type ?? sample.topic ?? ''), labelOf(sample.severity, SEVERITY_LABELS, '')]
    return parts.filter(Boolean).join(' · ')
  }
  if (type === 'round.completed' || type === 'defense.completed') {
    return [round, `命中 ${asArray(data.caught).length}`, `风险 ${asArray(data.risks).length}`, `修复 ${asArray(data.fixed).length}`].filter(Boolean).join(' · ')
  }
  if (type === 'attack.compromised') {
    const outcome = data.simulated === true
      ? '规则推定穿透，真实目标未验证'
      : data.targetVerified === true ? '目标已验证' : '目标未验证'
    return [round, outcome].filter(Boolean).join(' · ')
  }
  if (type.startsWith('agent.call.')) {
    const correlation = typeof data.correlationId === 'string' ? data.correlationId.slice(0, 8) : ''
    return [correlation, formatDuration(data.durationMs), String(data.dispatchMode ?? '未知来源')].filter(Boolean).join(' · ')
  }
  return ''
}

function verdictTone(verdict?: string, verificationMode?: string): Tone {
  if (verdict === 'attacker_won' && verificationMode === 'simulated') return 'orange'
  if (verdict === 'attacker_won') return 'red'
  if (verdict === 'defender_won') return 'green'
  return 'gray'
}

export function AdminBattleDetail(props: Props) {
  const { battle, rounds, score, events, audit, detailData, showRawData = false, hasMoreEvents, onLoadMoreEvents, selectedEvent, onSelectEvent } = props
  const [openSequence, setOpenSequence] = useState<number | null>(null)

  const orderedEvents = useMemo(() => events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => (left.event.sequence ?? Number.MAX_SAFE_INTEGER) - (right.event.sequence ?? Number.MAX_SAFE_INTEGER) || left.index - right.index)
    .map(({ event }) => event), [events])

  const finalEvent = [...orderedEvents].reverse().find((event) => ['battle.completed', 'battle.failed'].includes(eventType(event)))
  const finalData = eventData(finalEvent)
  const recordedVerdict = finalData.verdict ?? battle.verdict
  const verdict = typeof recordedVerdict === 'string' && recordedVerdict ? recordedVerdict : undefined
  const compromiseEvent = [...orderedEvents].reverse().find((event) => eventType(event) === 'attack.compromised')
  const compromiseData = eventData(compromiseEvent)
  const verificationMode = typeof finalData.verificationMode === 'string'
    ? finalData.verificationMode
    : compromiseData.simulated === true ? 'simulated' : typeof compromiseData.verificationMode === 'string' ? compromiseData.verificationMode : undefined
  const compromisedRounds = typeof finalData.compromisedRounds === 'number' ? finalData.compromisedRounds : undefined
  const interceptedRounds = typeof finalData.interceptedRounds === 'number' ? finalData.interceptedRounds : undefined
  const stats = rounds?.stats
  const roundList = asArray<AdminBattleRounds['rounds'][number]>(rounds?.rounds)

  const verdictNote = (() => {
    if (verdict === 'attacker_won') {
      const mode = verificationMode === 'simulated' ? '规则推定，真实目标未验证' : '已有验证证据'
      return `沦陷 ${formatNumber(compromisedRounds)} 轮、拦截成功 ${formatNumber(interceptedRounds)} 轮；验证方式：${mode}`
    }
    if (verdict === 'defender_won') return `拦截成功 ${formatNumber(interceptedRounds)} 轮，未发现已验证沦陷`
    if (verdict === 'undetermined') {
      return verificationMode === 'off'
        ? '未取得验证证据，无法判定谁得手（当前验证开关为 off，属预期行为）'
        : '未取得验证证据，无法判定谁得手'
    }
    if (battle.status === 'failed') return '战局执行失败，没有终局判定'
    if (battle.status === 'pending' || battle.status === 'running') return '战局尚未结束，暂无判定'
    return '记录中没有终局事件，无法给出判定'
  })()

  const auditRecord = asRecord(audit)
  const auditIssues = asArray<Record<string, unknown>>(auditRecord.issues)
  const auditValid = auditRecord.valid === true

  return <div className="admin-readable" aria-label="战局可读视图">
    <section className="readable-card readable-verdict" aria-label="战局结论">
      <header className="readable-card-head"><h3>战局结论</h3><small>依据事件链与验证证据得出</small></header>
      <div className={`verdict-line tone-${verdictTone(verdict, verificationMode)}`}><strong>{verdictLabel(verdict, verificationMode)}</strong><span>{verdictNote}</span></div>
      <dl className="readable-stats">
        <div><dt>攻击样本</dt><dd>{formatNumber(stats?.attackGenerated)}</dd></div>
        <div><dt>防守命中</dt><dd>{formatNumber(stats?.defenderDetected)}</dd></div>
        <div><dt>修复建议</dt><dd>{formatNumber(stats?.fixesSuggested)}</dd></div>
        <div><dt>战略检测</dt><dd>{formatNumber(stats?.strategyChecks)}</dd></div>
      </dl>
      <p className="readable-hint">判定需要验证证据；默认关闭验证时结果为“未判定”，详见 docs/ADMIN_CONTENT_GUIDE.md。</p>
    </section>

    <section className="readable-card" aria-label="回合明细">
      <header className="readable-card-head">
        <h3>回合明细（{rounds ? `${rounds.total} 轮` : '暂无'}）</h3>
        {rounds && rounds.requestedRounds !== undefined && rounds.requestedRounds !== rounds.total && <small>请求 {rounds.requestedRounds} 轮，实际产出 {rounds.total} 轮</small>}
      </header>
      {roundList.length ? <div className="readable-table-wrap">
        <table className="readable-table">
          <thead><tr><th scope="col">回合</th><th scope="col">状态</th><th scope="col">攻击样本</th><th scope="col">命中</th><th scope="col">风险</th><th scope="col">修复建议</th><th scope="col">耗时</th><th scope="col">本轮结果</th><th scope="col">独立裁决</th></tr></thead>
          <tbody>{roundList.map((round) => {
            const outcome = roundOutcome(round)
            const arbiter = arbiterOutcome(round)
            const sample = asRecord(round.sample)
            const sampleText = String(sample.type ?? sample.topic ?? '未记录')
            const severity = labelOf(sample.severity, SEVERITY_LABELS, '')
            return <tr key={round.round}>
              <td>第 {round.round} 轮</td>
              <td>{labelOf(round.status, STATUS_LABELS)}</td>
              <td>{sampleText}{severity ? ` · ${severity}` : ''}</td>
              <td>{asArray(round.caught).length}</td>
              <td>{asArray(round.risks).length}</td>
              <td>{asArray(round.fixed).length}</td>
              <td>{formatDuration(round.durationMs)}</td>
              <td><span className={`outcome-pill tone-${outcome.tone}`}>{outcome.label}</span></td>
              <td>{arbiter ? <span className={`outcome-pill tone-${arbiter.tone}`} title={arbiterTitle(round)}>{arbiter.label}</span> : <span className="readable-hint">未记录</span>}</td>
            </tr>
          })}</tbody>
        </table>
      </div> : <p className="empty">暂无回合记录，可能是战局尚未开始或事件未落库。</p>}
      {roundList.some((round) => round.arbiterReview) && <p className="readable-hint">独立裁决由 arbiter 单独复核本轮，不改变“本轮结果”；来源标注为 arbiter-rule-fallback 时未调用模型，只按证据规则判定。</p>}
    </section>

    <section className="readable-card" aria-label="评分">
      <header className="readable-card-head"><h3>评分</h3>{score?.version && <small>规则版本 {score.version}</small>}</header>
      <div className="readable-score-grid">
        {([['攻击方', score?.attacker], ['防守方', score?.defender]] as const).map(([title, role]) => <div className="score-column" key={title}>
          <div className="score-head"><strong>{title}</strong><span>{typeof role?.score === 'number' ? `${role.score} / ${formatNumber(role?.maxScore)}` : '证据不足'}</span></div>
          {typeof role?.summary?.finalScore === 'number' && <p className="score-final">综合分 {role.summary.finalScore}</p>}
          <ul className="score-list">
            {asArray<NonNullable<typeof role>['categories'][number]>(role?.categories).map((category, index) => {
              const value = typeof category.score === 'number' ? category.score : null
              const max = typeof category.maxScore === 'number' && category.maxScore > 0 ? category.maxScore : 0
              const ratio = value !== null && max ? Math.min(1, Math.max(0, value / max)) : 0
              return <li key={`${category.id ?? category.label}-${index}`}>
                <span className="score-label">{category.label}</span>
                <span className="score-value">{value === null ? '证据不足' : `${value} / ${max}`}</span>
                <span className="score-bar" aria-hidden="true"><i style={{ width: `${ratio * 100}%` }} /></span>
              </li>
            })}
            {!asArray(role?.categories).length && <li className="empty">暂无评分分项</li>}
          </ul>
        </div>)}
      </div>
      {score?.message && <p className="readable-hint">{score.message}</p>}
    </section>

    <section className="readable-card" aria-label="事件时间线">
      <header className="readable-card-head"><h3>事件时间线（{orderedEvents.length} 条）</h3><small>点击任一行可在 3D 回放中定位</small></header>
      {orderedEvents.length ? <ol className="readable-events">
        {orderedEvents.map((event, index) => {
          const sequence = typeof event.sequence === 'number' ? event.sequence : index + 1
          const summary = eventSummary(event)
          const active = selectedEvent === event
          const expanded = openSequence === sequence
          return <li key={`${sequence}-${index}`} className={active ? 'active' : ''}>
            <button type="button" className="event-row" onClick={() => onSelectEvent(event)} aria-pressed={active}>
              <span className="event-seq">#{sequence}</span>
              <span className="event-name">{eventLabel(eventType(event))}</span>
              <span className="event-time">{formatClock(event.timestamp ?? event.createdAt)}</span>
              <span className="event-summary">{summary}</span>
            </button>
            <button type="button" className="event-raw-toggle" aria-expanded={expanded} onClick={() => setOpenSequence(expanded ? null : sequence)}>查看原始数据</button>
            {expanded && <pre className="data-preview">{JSON.stringify(event, null, 2)}</pre>}
          </li>
        })}
      </ol> : <p className="empty">暂无事件记录。</p>}
      {hasMoreEvents && <button type="button" className="readable-more" onClick={onLoadMoreEvents}>加载更多事件</button>}
    </section>

    <section className="readable-card" aria-label="事件链完整性">
      <header className="readable-card-head"><h3>事件链完整性</h3><small>只读校验，不修改战局</small></header>
      {auditRecord.valid === undefined
        ? <p className="empty">审计结果未记录。</p>
        : auditValid
          ? <p className="outcome-pill tone-green">事件链完整（{formatNumber(auditRecord.eventCount)} 条事件，0 个问题）</p>
          : <><p className="outcome-pill tone-red">发现 {formatNumber(auditRecord.issueCount ?? auditIssues.length)} 个问题</p>
            <ul className="readable-issues">{auditIssues.map((issue, index) => <li key={`${String(issue.code)}-${index}`}><strong>{labelOf(issue.code, AUDIT_ISSUE_LABELS, String(issue.code ?? '未知问题'))}</strong>{typeof issue.message === 'string' && <span>{issue.message}</span>}</li>)}</ul></>}
    </section>

    {showRawData && <details className="admin-raw-data">
      <summary>原始数据（排查用）</summary>
      {Object.entries(detailData).filter(([key]) => key !== '事件').map(([key, value]) => <details key={key}><summary>{key}</summary><pre className="data-preview" aria-label={`${key}原始数据`}>{JSON.stringify(value ?? {}, null, 2)}</pre></details>)}
      <details><summary>事件</summary><pre className="data-preview" aria-label="事件原始数据">{JSON.stringify(events ?? [], null, 2)}</pre></details>
    </details>}

    <p className="readable-meta">难度：{labelOf(battle.difficulty, DIFFICULTY_LABELS)} · 验证方式：{labelOf(verificationMode, VERIFICATION_MODE_LABELS, '未记录')} · 回合数：{formatNumber(battle.rounds)}</p>
  </div>
}

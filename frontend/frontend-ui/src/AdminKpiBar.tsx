/**
 * 首屏关键指标条：吸顶在顶部，保证不用滚动就能看到“多少场、成了多少、失败多少、慢不慢”。
 * 数据全部来自 /dashboard/summary + /metrics，缺字段显示 “—”，不猜值。
 */
import type { ReactNode } from 'react'

type Props = {
  summary: Record<string, unknown> | null
  metrics: Record<string, unknown> | null
}

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const count = (value: number | null): string => (value === null ? '—' : value.toLocaleString('zh-CN'))
const percent = (part: number | null, total: number | null): string => {
  if (part === null || total === null || total <= 0) return '—'
  return `${Number(((part / total) * 100).toFixed(1))}%`
}
const latency = (value: number | null): string => {
  if (value === null) return '—'
  return value >= 1000 ? `${Number((value / 1000).toFixed(2))} 秒` : `${Number(value.toFixed(1))} 毫秒`
}

type Tile = { key: string; label: string; value: string; hint?: string; alert?: boolean }

export function AdminKpiBar({ summary, metrics }: Props) {
  const merged: Record<string, unknown> = { ...(summary ?? {}), ...(metrics ?? {}) }
  const total = num(merged.totalBattles)
  const completed = num(merged.completedBattles)
  const failed = num(merged.failedBattles)
  const pending = total !== null && completed !== null && failed !== null ? Math.max(0, total - completed - failed) : null

  const tiles: Tile[] = [
    { key: 'total', label: '总战局', value: count(total) },
    { key: 'completion', label: '完成率', value: percent(completed, total), hint: `已完成 ${count(completed)}` },
    { key: 'failure', label: '失败率', value: percent(failed, total), hint: `失败 ${count(failed)}`, alert: (failed ?? 0) > 0 },
    { key: 'pending', label: '待处理', value: count(pending), hint: '等待中或进行中' },
    { key: 'high', label: '高难度战局', value: count(num(merged.highDifficultyBattles)) },
    { key: 'events', label: '事件总数', value: count(num(merged.events)) },
    { key: 'latency', label: '接口平均延迟', value: latency(num(merged.averageLatencyMs)) },
    { key: 'agentLatency', label: '智能体平均响应', value: latency(num(merged.averageAgentCallLatencyMs)) },
  ]

  return (
    <section className="admin-kpi" aria-label="关键指标">
      {tiles.map((tile): ReactNode => (
        <div className={`kpi${tile.alert ? ' kpi-alert' : ''}`} key={tile.key}>
          <span>{tile.label}</span>
          <strong>{tile.value}</strong>
          {tile.hint && <small>{tile.hint}</small>}
        </div>
      ))}
    </section>
  )
}

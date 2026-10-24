import { METRIC_LABELS } from './adminLabels'

/** 数字指标分组：按运维视角把 summary + metrics 两个接口的字段归拢成人能读的卡片。 */
const METRIC_GROUPS: { title: string; hint: string; keys: string[] }[] = [
  {
    title: '战局概况',
    hint: '',
    keys: ['totalBattles', 'completedBattles', 'failedBattles', 'highDifficultyBattles', 'events', 'auditEvents'],
  },
  {
    title: '攻防效果（累计）',
    hint: '攻击样本用于试探，防守命中的是规则或模型识别出的结果。',
    keys: ['attackGenerated', 'defenderDetected', 'fixesSuggested', 'strategyChecks', 'sampleCount', 'ruleHitCount', 'riskCount', 'recommendationCount'],
  },
  {
    title: '服务运行',
    hint: '延迟与错误按后台进程启动至今累计统计。',
    keys: ['uptimeSeconds', 'requests', 'errors', 'averageLatencyMs', 'maxLatencyMs', 'activeBattleTasks', 'recoveryTasks', 'battleTimeouts', 'battleCancellations'],
  },
  {
    title: '限流与防护',
    hint: '限流触发说明单位时间内请求过多；读接口鉴权开启后，未登录无法直接读数据。',
    keys: ['rateLimited', 'rateLimitPerMinute', 'eventDataMaxBytes', 'protectReadRoutes'],
  },
  {
    title: '智能体调用（ACP）',
    hint: '',
    keys: ['acpRetries', 'acpTimeouts'],
  },
]

/** 与 totalBattles 重复的接口字段，分组里已用更明确的名称展示，不再重复出现。 */
const DUPLICATE_KEYS = new Set(['battles'])

const BYTE_KEYS = new Set(['eventDataMaxBytes'])
const LATENCY_KEYS = new Set(['averageLatencyMs', 'maxLatencyMs'])
const SECONDS_KEYS = new Set(['uptimeSeconds'])
const BOOLEAN_KEYS = new Set(['protectReadRoutes'])
/** 这些指标大于 0 时需要提醒，因为它们代表异常而非正常业务量。 */
const ALERT_KEYS = new Set(['errors', 'rateLimited', 'acpTimeouts'])

const numberText = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })

function formatBytes(value: number): string {
  if (value < 1024) return `${numberText(value)} 字节`
  if (value < 1024 * 1024) return `${numberText(Number((value / 1024).toFixed(1)))} KB`
  return `${numberText(Number((value / (1024 * 1024)).toFixed(1)))} MB`
}

function formatUptime(value: number): string {
  if (value < 60) return `${numberText(Math.round(value))} 秒`
  const totalMinutes = Math.floor(value / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours <= 0) return `${totalMinutes} 分 ${Math.round(value % 60)} 秒`
  if (hours < 24) return `${hours} 小时 ${minutes} 分`
  return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`
}

function formatValue(key: string, value: unknown): string {
  if (BOOLEAN_KEYS.has(key)) return value ? '已开启' : '未开启'
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  if (BYTE_KEYS.has(key)) return formatBytes(value)
  if (SECONDS_KEYS.has(key)) return formatUptime(value)
  if (LATENCY_KEYS.has(key)) return value >= 1000 ? `${numberText(Number((value / 1000).toFixed(2)))} 秒` : `${numberText(value)} 毫秒`
  return numberText(value)
}

type Props = {
  summary: Record<string, unknown> | null
  metrics: Record<string, unknown> | null
}

export function AdminMetricsPanel({ summary, metrics }: Props) {
  // summary 与 metrics 的键不冲突，合并后统一分组；metrics 优先，避免同一指标两份数据打架。
  const merged: Record<string, unknown> = { ...(summary ?? {}), ...(metrics ?? {}) }
  const known = new Set(METRIC_GROUPS.flatMap((group) => group.keys))
  const leftovers = Object.keys(merged).filter((key) => !known.has(key) && !DUPLICATE_KEYS.has(key) && typeof merged[key] === 'number')
type MetricEntry = readonly [string, unknown]
type MetricGroup = { title: string; hint: string; entries: MetricEntry[] }

  const groups: MetricGroup[] = METRIC_GROUPS
    .map((group) => ({ title: group.title, hint: group.hint, entries: group.keys.filter((key) => key in merged).map((key) => [key, merged[key]] as const) }))
    .filter((group) => group.entries.length > 0)
  if (leftovers.length) groups.push({ title: '其他指标', hint: '后台新增但尚未配中文名的指标，按原始字段名显示。', entries: leftovers.map((key) => [key, merged[key]] as const) })

  const serviceName = typeof merged.service === 'string' ? merged.service : ''
  const hasData = groups.length > 0

  return (
    <section className="admin-module metrics">
      <div className="module-head"><h2>运行指标</h2><span>{serviceName || (hasData ? '进程累计统计' : '暂无数据')}</span></div>
      {hasData ? (
        <div className="metric-groups">
          {groups.map((group) => (
            <div className="metric-group" key={group.title}>
              <h3>{group.title}</h3>
              <div className="metric-grid">
                {group.entries.map(([key, value]) => (
                  <div className={`metric${ALERT_KEYS.has(key) && typeof value === 'number' && value > 0 ? ' metric-alert' : ''}`} key={key}>
                    <span>{METRIC_LABELS[key] ?? key}</span>
                    <strong>{formatValue(key, value)}</strong>
                  </div>
                ))}
              </div>
              {group.hint && <p className="metric-note">{group.hint}</p>}
            </div>
          ))}
        </div>
      ) : <p className="empty">暂无指标</p>}
    </section>
  )
}

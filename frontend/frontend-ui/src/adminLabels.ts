/** Shared Chinese labels for the admin console. Pure lookups only: no requests, no React. */

export const STATUS_LABELS: Record<string, string> = {
  pending: '等待中', running: '进行中', completed: '已完成', failed: '失败',
}

export const DIFFICULTY_LABELS: Record<string, string> = { low: '低', mid: '中', high: '高' }

export const VERDICT_LABELS: Record<string, string> = {
  attacker_won: '攻击得手（目标已验证）',
  defender_won: '防守成功',
  undetermined: '结果未判定',
}

export const METRIC_LABELS: Record<string, string> = {
  totalBattles: '总战局', completedBattles: '已完成', failedBattles: '失败', highDifficultyBattles: '高难度战局',
  attackGenerated: '攻击样本生成', defenderDetected: '防守命中', fixesSuggested: '修复建议', strategyChecks: '战略检测',
  sampleCount: '攻击样本', ruleHitCount: '规则命中', riskCount: '风险项', recommendationCount: '防守建议',
  uptimeSeconds: '运行时长', requests: '累计请求', errors: '错误数', averageLatencyMs: '接口平均延迟',
  maxLatencyMs: '接口最大延迟', rateLimited: '限流请求', rate_limited: '限流请求', rateLimitPerMinute: '每分钟请求上限',
  eventDataMaxBytes: '事件数据上限', recoveryTasks: '恢复任务', activeBattleTasks: '活跃战局任务',
  protectReadRoutes: '读接口鉴权', battleTimeouts: '战局超时次数', battleCancellations: '战局取消次数',
  acpRetries: '智能体重试', acpTimeouts: '智能体超时', auditEvents: '审计事件', battles: '战局总数',
  events: '事件总数', service: '服务名称',
  // 前端计算的比率（不来自接口）
  completionRate: '完成率', failureRate: '失败率',
  // /dashboard/summary 的攻击样本与防守结果
  defenseSummary: '防守命中（含建议/风险）', simulationSampleCount: '模拟样本',
  // 智能体调用（ACP）
  acpCallBattles: '触发智能体战局', agentExecutionCount: '智能体执行次数', acpRequestCount: '智能体调用次数',
  acpSuccessCount: '智能体调用成功', acpFailureCount: '智能体调用失败', acpRuleFallbackCount: '规则兜底次数',
  reportedLlmResultCount: '大模型结果采用', averageAgentCallLatencyMs: '智能体平均响应',
  attackerCallCount: '攻击方调用', defenderCallCount: '防守方调用',
  // 本地知识库
  ruleLibraryCaseCount: '规则库用例', owaspLlmRuleCount: 'OWASP LLM 规则', localRuleExecutionCount: '本地规则执行',
}

/** 审计日志 data 字段的中文名；未登记键按原始键名显示。 */
export const AUDIT_DATA_LABELS: Record<string, string> = {
  battleId: '战局 ID', battleCode: '战局编号', code: '编号', topic: '主题', difficulty: '难度', rounds: '回合数',
  sampleId: '样本 ID', ruleId: '规则 ID', changes: '改动字段', operation: '操作', target: '对象', targetId: '对象 ID',
  reason: '原因', status: '状态', actor: '操作人', actorRole: '角色', source: '来源', count: '数量',
  before: '变更前', after: '变更后', ip: '来源 IP', userAgent: '客户端', requestId: '请求 ID',
}

/** Ordered whitelist for the overview metric grid; anything else renders after these. */
export const METRIC_ORDER = [
  'totalBattles', 'completedBattles', 'failedBattles', 'highDifficultyBattles',
  'attackGenerated', 'defenderDetected', 'fixesSuggested', 'strategyChecks',
  'sampleCount', 'ruleHitCount', 'riskCount', 'recommendationCount',
]

export const EVENT_LABELS: Record<string, string> = {
  'battle.created': '战局创建',
  'battle.retry': '战局重试',
  'battle.cancel.requested': '请求取消战局',
  'battle.cancelled': '战局已取消',
  'battle.completed': '战局完成',
  'battle.failed': '战局失败',
  'battle.timeout': '战局超时',
  'battle.idempotency.reused': '命中幂等复用',
  'attack.started': '攻击阶段开始',
  'attack.sample.generated': '攻击样本生成',
  'attack.completed': '攻击阶段完成',
  'attack.compromised': '目标沦陷（已验证）',
  'round.started': '防守检测开始',
  'round.completed': '本轮检测结果',
  'defense.completed': '防守阶段完成',
  'agent.call.started': '智能体调用开始',
  'agent.call.completed': '智能体调用完成',
  'agent.call.failed': '智能体调用失败',
}

export const AUDIT_ISSUE_LABELS: Record<string, string> = {
  missing_battle_id: '战局缺少 ID',
  non_contiguous_sequence: '事件序号不连续或顺序错误',
  duplicate_event_id: '事件 ID 重复',
  event_battle_mismatch: '事件归属的战局不一致',
  missing_event_status: '事件缺少状态',
  missing_battle_created: '时间线缺少开始事件',
  missing_battle_completed: '时间线缺少结束事件',
  attacker_source_mismatch: '攻击来源未在事件中留痕',
  defender_source_mismatch: '防守来源未在事件中留痕',
}

export const SEVERITY_LABELS: Record<string, string> = {
  low: '低危', medium: '中危', high: '高危', critical: '严重',
}

export const VERIFICATION_MODE_LABELS: Record<string, string> = {
  off: '未开启验证', simulated: '模拟验证', live: '真实验证',
}

export function labelOf(value: unknown, labels: Record<string, string>, fallback = '暂无'): string {
  if (value === null || value === undefined || value === '') return fallback
  const key = String(value)
  return labels[key] ?? key
}

export const eventLabel = (type: unknown) => labelOf(type, EVENT_LABELS, '战局事件')

export function formatDuration(ms: unknown): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)} 毫秒`
  return `${(ms / 1000).toFixed(1)} 秒`
}

export function formatClock(value: unknown): string {
  if (typeof value !== 'string' || !value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString('zh-CN', { hour12: false })
}

export function formatNumber(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '—'
}

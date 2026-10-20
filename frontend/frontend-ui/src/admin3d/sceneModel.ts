import type { AdminBattle, AdminBattleEvent, AdminMetrics } from '../adminApi'
import type { ExternalCase } from '../api'
import type { AdminBattleScore } from '../adminApi'

const SECURITY_BARRIER_LABELS = ['输入标准化清洗', '推理引导', '工具动作管控', '审计监测恢复']
const SECURITY_BARRIER_COLORS = ['#00D4AA', '#9B59B6', '#F39C12', '#E74C3C']

export type AdminSceneNodeKind = 'attacker' | 'defender' | 'scheduler' | 'battle' | 'external-case' | 'timeline-event' | 'attack-jump' | 'defender-asset' | 'security-barrier'
export type AdminSceneActorRole = 'attacker' | 'defender' | 'system' | 'unknown'
export type AdminSceneStatus = 'pending' | 'running' | 'completed' | 'failed' | 'unknown'
export type AdminSceneNode = {
  id: string
  kind: AdminSceneNodeKind
  label: string
  status: AdminSceneStatus
  color: string
  position: [number, number, number]
  actorRole?: AdminSceneActorRole
  barrierIndex?: number
  networkState?: 'normal' | 'compromised'
  evidenceEvents?: AdminBattleEvent[]
  timestamp?: string
  relatedCases?: ExternalCase[]
  source: AdminBattle | AdminBattleEvent | ExternalCase | AdminMetrics | null
}
export type AdminSceneEdge = {
  id: string
  from: string
  to: string
  status: AdminSceneStatus
  color: string
  kind?: 'timeline' | 'interaction' | 'network'
}
export type AdminSceneModel = {
  nodes: AdminSceneNode[]
  edges: AdminSceneEdge[]
  statusColors: Record<AdminSceneStatus, string>
  topic?: string
  difficulty?: string
  sampleCount?: number
  score?: AdminBattleScore | null
}

export type SecurityPathTheme = {
  name: string
  focusedLayers: number[]
}

export const SECURITY_PATH_THEMES: Array<{ match: RegExp; theme: SecurityPathTheme }> = [
  { match: /提示注入|工单注入|工单备注注入|越狱诱导|偏见注入/i, theme: { name: '输入诱导类攻击', focusedLayers: [1, 2] } },
  { match: /上下文投毒/i, theme: { name: '上下文投毒', focusedLayers: [1, 2] } },
  { match: /sql\s*注入|数据窃取/i, theme: { name: 'SQL 注入 / 数据窃取', focusedLayers: [1, 3] } },
  { match: /权限校验|权限提升|越权测试|越权/i, theme: { name: '权限校验 / 越权测试', focusedLayers: [2, 3] } },
  { match: /工具调用滥用|工具滥用/i, theme: { name: '工具调用滥用', focusedLayers: [2, 3] } },
  { match: /通用安全测试/i, theme: { name: '通用安全测试', focusedLayers: [1, 2, 3, 4] } },
]

export function securityPathTheme(topic?: string): SecurityPathTheme {
  const value = String(topic ?? '')
  return SECURITY_PATH_THEMES.find((entry) => entry.match.test(value))?.theme ?? { name: value || '通用攻防路径', focusedLayers: [1, 2, 3, 4] }
}

export type ReplayEventCueKind = 'probe' | 'attack' | 'exploit' | 'compromised' | 'session' | 'defense-request' | 'defense' | 'other'
export type ReplayEventCue = { kind: ReplayEventCueKind; label: string; color: string }

export function replayEventCue(event: Pick<AdminBattleEvent, 'eventType' | 'type' | 'data'>): ReplayEventCue {
  const type = String(event.eventType ?? event.type ?? '').toLowerCase()
  const detail = String(event.data?.description ?? event.data?.event ?? '').toLowerCase()
  const value = `${type} ${detail}`
  if (type === 'round.started') return { kind: 'defense-request', label: '攻击样本送检', color: '#57e8c7' }
  if (type === 'round.completed') {
    const caught = Array.isArray(event.data?.caught) ? event.data.caught.length : 0
    return { kind: 'defense', label: caught ? `防守命中 ${caught} 项` : '防守未命中', color: '#57e8c7' }
  }
  if (/compromis|breach|被攻陷|沦陷|入侵成功/.test(value)) return { kind: 'compromised', label: '节点沦陷', color: '#ff4e64' }
  if (/fail|失败|error|异常/.test(value)) return { kind: 'other', label: '战局失败', color: '#ff4e64' }
  if (/exploit|漏洞利用|利用成功/.test(value)) return { kind: 'exploit', label: '漏洞利用', color: '#ff815e' }
  if (/probe|scan|port.scan|端口扫描|扫描探测/.test(value)) return { kind: 'probe', label: '扫描探测', color: '#00dfdc' }
  if (/session|会话建立|建立会话/.test(value)) return { kind: 'session', label: '建立会话', color: '#67d7ff' }
  if (/attack|攻击/.test(value)) return { kind: 'attack', label: '发起攻击', color: '#ff9b56' }
  return { kind: 'other', label: String(event.eventType ?? event.type ?? '战局事件'), color: '#9bdcff' }
}

export type BuildAdminSceneModelInput = {
  battles: AdminBattle[]
  metrics: AdminMetrics
  externalCases: ExternalCase[]
}

const MAX_NODES = 64
const MAX_EDGES = 128
const statusColors: AdminSceneModel['statusColors'] = {
  pending: '#8b9bab', running: '#24c7bd', completed: '#62b878', failed: '#ed6b58', unknown: '#d1a84b',
}

function sceneStatus(value: string): AdminSceneStatus {
  return value in statusColors ? value as AdminSceneStatus : 'unknown'
}

function timestamp(value?: string): number {
  const parsed = value ? Date.parse(value) : 0
  return Number.isFinite(parsed) ? parsed : 0
}

export function eventActorRole(event: AdminBattleEvent): AdminSceneActorRole {
  const data = event.data ?? {}
  const explicitRole = data.agentRole ?? data.actorRole
  if (explicitRole === 'attacker' || explicitRole === 'defender') return explicitRole

  const type = eventType(event)
  if (type.startsWith('attack.')) return 'attacker'
  if (type.startsWith('round.') || type.startsWith('defense.')) return 'defender'
  if (type.startsWith('battle.')) return 'system'
  return 'unknown'
}

export function eventActorLabel(role: AdminSceneActorRole): string {
  if (role === 'attacker') return '攻击方'
  if (role === 'defender') return '防守方'
  if (role === 'system') return '调度系统'
  return '来源未记录'
}

function agentCallPhase(event: AdminBattleEvent): string | undefined {
  const type = eventType(event)
  if (type === 'agent.call.started') return '发起'
  if (type === 'agent.call.completed') return '完成'
  if (type === 'agent.call.failed') return '失败'
  return undefined
}

export function eventFlowLabel(
  event: AdminBattleEvent,
  previousEvent?: AdminBattleEvent,
  nextEvent?: AdminBattleEvent,
): string {
  const data = event.data ?? {}
  const type = eventType(event)
  if (type === 'round.started') return '攻击方 → 防守方'
  if (type === 'round.completed') return '防守方 → 攻击方'
  const flow = data.flow
  if (flow && typeof flow === 'object') {
    const fromRole = (flow as Record<string, unknown>).fromRole
    const toRole = (flow as Record<string, unknown>).toRole
    if ((fromRole === 'attacker' || fromRole === 'defender') && (toRole === 'attacker' || toRole === 'defender')) {
      return `${eventActorLabel(fromRole)} → ${eventActorLabel(toRole)}`
    }
  }
  const role = eventActorRole(event)
  const correlationId = data.correlationId
  const phase = agentCallPhase(event)
  if (typeof correlationId === 'string' && correlationId && phase && (role === 'attacker' || role === 'defender')) {
    const previousPhase = previousEvent ? agentCallPhase(previousEvent) : undefined
    if (previousEvent
      && eventActorRole(previousEvent) === role
      && previousEvent.data?.correlationId === correlationId
      && previousPhase) {
      return `${eventActorLabel(role)}内部调用：${previousPhase} → ${phase}`
    }
    const nextPhase = nextEvent ? agentCallPhase(nextEvent) : undefined
    if (nextEvent
      && eventActorRole(nextEvent) === role
      && nextEvent.data?.correlationId === correlationId
      && nextPhase) {
      return `${eventActorLabel(role)}内部调用：${phase} → ${nextPhase}`
    }
  }
  const previousRole = previousEvent ? eventActorRole(previousEvent) : 'unknown'
  const nextRole = nextEvent ? eventActorRole(nextEvent) : 'unknown'
  if ((previousRole === 'attacker' || previousRole === 'defender') && (role === 'attacker' || role === 'defender') && previousRole !== role) {
    return `${eventActorLabel(previousRole)} → ${eventActorLabel(role)}`
  }
  if ((nextRole === 'attacker' || nextRole === 'defender') && (role === 'attacker' || role === 'defender') && nextRole !== role) {
    return `${eventActorLabel(role)} → ${eventActorLabel(nextRole)}`
  }
  if (role === 'attacker' || role === 'defender') return `${eventActorLabel(role)}处理环节`
  if (role === 'system') return '调度与战局状态'
  return '交互关系未记录'
}

function eventData(event: AdminBattleEvent): Record<string, unknown> {
  return event.data && typeof event.data === 'object' ? event.data : {}
}

function countItems(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

function recordedFailureReason(event: AdminBattleEvent, events: AdminBattleEvent[]): string | undefined {
  const fields = ['error', 'message', 'detail', 'reason']
  const candidates = [event, ...events.filter((item) => eventType(item) === 'agent.call.failed')]
  for (const candidate of candidates) {
    const data = eventData(candidate)
    for (const field of fields) {
      const value = data[field]
      if (typeof value === 'string' && value.trim()) {
        const role = data.agentRole === 'attacker' ? '攻击方' : data.agentRole === 'defender' ? '防守方' : ''
        return `${role ? `${role}：` : ''}${value.trim()}`
      }
    }
  }
  return undefined
}

export function replayEventSummary(event: AdminBattleEvent, events: AdminBattleEvent[] = []): string | undefined {
  const type = eventType(event)
  const data = eventData(event)
  if (type === 'attack.sample.generated') {
    return `攻击方已提交第 ${typeof data.round === 'number' ? data.round : '—'} 轮样本，现送交防守方检测。`
  }
  if (type === 'round.started') {
    return `第 ${typeof data.round === 'number' ? data.round : '—'} 轮检测开始：防守方正在分析攻击样本。`
  }
  if (type === 'round.completed') {
    const caught = countItems(data.caught)
    const risks = countItems(data.risks)
    const fixed = countItems(data.fixed)
    const result = caught ? `命中 ${caught} 条样本规则` : '未命中当前规则'
    const verification = data.targetVerified === true
      ? '已记录真实目标验证证据。'
      : '真实目标未验证，不能据此判定沦陷。'
    return `防守方完成第 ${typeof data.round === 'number' ? data.round : '—'} 轮检测：${result}，记录 ${risks} 项风险和 ${fixed} 条验证建议。${verification}`
  }
  if (type === 'defense.completed') {
    const rounds = events.filter((item) => eventType(item) === 'round.completed').length
    return `防守方已完成 ${rounds} 轮检测，结果已回传。`
  }
  if (type === 'battle.failed') {
    const reason = recordedFailureReason(event, events)
    return reason ? `流程中断：${reason}` : '流程中断：记录中未提供失败原因，无法确定具体中断环节。'
  }
  if (type === 'battle.completed') {
    const samples = events.filter((item) => eventType(item) === 'attack.sample.generated')
    const defenses = events.filter((item) => eventType(item) === 'round.completed')
    const caught = defenses.reduce((sum, item) => sum + countItems(eventData(item).caught), 0)
    const risks = defenses.reduce((sum, item) => sum + countItems(eventData(item).risks), 0)
    const fixed = defenses.reduce((sum, item) => sum + countItems(eventData(item).fixed), 0)
    const verifiedCompromises = events.filter((item) => {
      const itemData = eventData(item)
      return /compromis|breach|沦陷|攻陷/i.test(eventType(item)) && itemData.targetVerified === true
    }).length
    const scope = verifiedCompromises
      ? `记录到 ${verifiedCompromises} 条目标验证沦陷证据。`
      : '真实目标未验证，不能据此判定沦陷；这是样本分析流程结果，不代表攻击成功。'
    return `流程成功完成：生成 ${samples.length} 份攻击样本，防守完成 ${defenses.length} 轮检测（命中 ${caught} 条规则、记录 ${risks} 项风险、提出 ${fixed} 条验证建议）。${scope}`
  }
  if (type === 'attack.compromised') {
    return data.targetVerified === true
      ? '已记录目标验证沦陷证据。'
      : '该事件未提供真实目标验证证据，不能据此判定目标已沦陷。'
  }
  return undefined
}

function eventType(event: AdminBattleEvent): string {
  return String(event.eventType ?? event.type ?? '')
}

function eventRound(event: AdminBattleEvent): number | undefined {
  const round = event.data?.round
  return typeof round === 'number' && Number.isFinite(round) ? round : undefined
}

export function buildAdminSceneModel(input: BuildAdminSceneModelInput): AdminSceneModel {
  const relatedCases = input.externalCases.slice(0, 8)
  const roleNodes: AdminSceneNode[] = [
    { id: 'role:attacker', kind: 'attacker', label: '攻击方', status: 'unknown', color: '#ed8b42', position: [-3, 0, 0], relatedCases, source: null },
    { id: 'role:defender', kind: 'defender', label: '防守方', status: 'unknown', color: '#55a7d1', position: [3, 0, 0], relatedCases, source: null },
    { id: 'role:scheduler', kind: 'scheduler', label: '调度中心', status: 'unknown', color: '#b6a3d8', position: [0, 0.5, -2], source: input.metrics },
  ]
  const capacity = MAX_NODES - roleNodes.length
  const battles = [...input.battles].sort((a, b) => {
    const active = Number(b.status === 'running' || b.status === 'pending') - Number(a.status === 'running' || a.status === 'pending')
    return active || timestamp(b.createdAt) - timestamp(a.createdAt)
  })
  const battleNodes: AdminSceneNode[] = battles.map((battle, index) => {
    const column = index % 3
    const row = Math.floor(index / 3)
    const status = sceneStatus(battle.status)
    return {
      id: `battle:${battle.id}`, kind: 'battle', label: battle.topic || battle.id, status,
      color: statusColors[status], position: [(column - 1) * 2.4, 0, 2.8 + (row % 2 ? -2 : 0) + Math.floor(row / 2) * 0.3],
      timestamp: battle.createdAt, source: battle,
    }
  })
  const nodes = [...roleNodes, ...battleNodes.slice(0, capacity)].slice(0, MAX_NODES)
  const edges: AdminSceneEdge[] = []
  for (const node of nodes) {
    if (node.kind !== 'battle' || edges.length >= MAX_EDGES) continue
    edges.push({ id: `attacker:${node.id}`, from: 'role:attacker', to: node.id, status: node.status, color: node.color })
    if (edges.length < MAX_EDGES) edges.push({ id: `defender:${node.id}`, from: node.id, to: 'role:defender', status: node.status, color: node.color })
    if ((node.status === 'pending' || node.status === 'running') && edges.length < MAX_EDGES) {
      edges.push({ id: `scheduler:${node.id}`, from: 'role:scheduler', to: node.id, status: node.status, color: node.color })
    }
  }
  return { nodes, edges: edges.slice(0, MAX_EDGES), statusColors }
}

export function buildBattleTimelineSceneModel(battle: AdminBattle, events: AdminBattleEvent[], externalCases: ExternalCase[] = [], score?: AdminBattleScore | null): AdminSceneModel {
  const relatedCases = externalCases.slice(0, 8)
  const orderedEvents = events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => (left.event.sequence ?? Number.MAX_SAFE_INTEGER) - (right.event.sequence ?? Number.MAX_SAFE_INTEGER) || left.index - right.index)
  const roleNodes: AdminSceneNode[] = [
    { id: 'role:attacker', kind: 'attacker', label: '攻击方', actorRole: 'attacker', status: 'unknown', color: '#63b4ff', position: [-12.5, 0.15, 0], relatedCases, source: battle },
    { id: 'role:defender', kind: 'defender', label: '防守方', actorRole: 'defender', status: 'unknown', color: '#57e8c7', position: [12.5, 0.15, 0], relatedCases, source: battle },
  ]
  const defenseCompleted = orderedEvents.find(({ event }) => eventType(event) === 'defense.completed')?.event ?? null
  const roundEvidence = orderedEvents
    .map(({ event }) => event)
    .filter((event) => eventType(event) === 'round.completed')
  const assetStatus: AdminSceneStatus = defenseCompleted ? 'completed' : sceneStatus(battle.status)
  const compromisedAssetIds = new Set(orderedEvents.flatMap(({ event }) => {
    if (eventType(event) !== 'attack.compromised' || event.data?.targetVerified !== true) return []
    const targetAssetId = event.data.targetAssetId
    return [targetAssetId === 'network:asset:1' || targetAssetId === 'network:asset:2' || targetAssetId === 'network:asset:3'
      ? targetAssetId
      : 'network:asset:3']
  }))
  const networkNodes: AdminSceneNode[] = [
    { id: 'network:jump:1', kind: 'attack-jump', label: '攻击跳板', networkState: 'compromised', actorRole: 'attacker', status: 'completed', color: '#63b4ff', position: [-7.8, 0.15, -1.2], relatedCases, source: battle },
    { id: 'network:jump:2', kind: 'attack-jump', label: '攻击跳板', networkState: 'compromised', actorRole: 'attacker', status: 'completed', color: '#63b4ff', position: [-5.2, 0.15, 1.2], relatedCases, source: battle },
    { id: 'network:asset:1', kind: 'defender-asset', label: '防守内网', networkState: compromisedAssetIds.has('network:asset:1') ? 'compromised' : 'normal', actorRole: 'defender', status: assetStatus, color: '#57e8c7', position: [6.6, 0.15, -2.4], relatedCases, source: battle },
    { id: 'network:asset:2', kind: 'defender-asset', label: '防守内网', networkState: compromisedAssetIds.has('network:asset:2') ? 'compromised' : 'normal', actorRole: 'defender', status: assetStatus, color: '#57e8c7', position: [6.6, 0.15, 0], relatedCases, source: battle },
    { id: 'network:asset:3', kind: 'defender-asset', label: '防守内网', networkState: compromisedAssetIds.has('network:asset:3') ? 'compromised' : 'normal', actorRole: 'defender', status: assetStatus, color: '#57e8c7', position: [6.6, 0.15, 2.4], relatedCases, source: battle },
  ]
  const eventNodes: AdminSceneNode[] = orderedEvents.map(({ event, index }, order) => {
    const sequence = event.sequence ?? index + 1
    const id = `event:${battle.id}:${sequence}:${index}`
    const status = sceneStatus(String(event.status ?? battle.status))
    const actorRole = eventActorRole(event)
    const x = actorRole === 'attacker' ? -1.45 : actorRole === 'defender' ? 1.45 : 0
    const depth = 3.2 + (orderedEvents.length < 2 ? 0 : (order / (orderedEvents.length - 1) - 0.5) * 5.2)
    return {
      id, kind: 'timeline-event', label: eventType(event) || String(event.status ?? `事件 ${sequence}`), status,
      actorRole, color: actorRole === 'attacker' ? '#ed8b42' : actorRole === 'defender' ? '#55a7d1' : statusColors[status],
      position: [x, Math.sin(order * 0.72) * 0.18, depth],
      timestamp: event.timestamp, source: event,
    }
  })
  const barrierNodes: AdminSceneNode[] = SECURITY_BARRIER_LABELS.map((label, index) => ({
    id: `security:barrier:${index + 1}`,
    kind: 'security-barrier',
    label,
    status: 'unknown',
    color: SECURITY_BARRIER_COLORS[index],
    barrierIndex: index + 1,
    position: [-3.6 + index * 2.4, 0.15, 0],
    relatedCases,
    evidenceEvents: roundEvidence,
    source: defenseCompleted,
  }))
  const nodes = [...roleNodes, ...networkNodes, ...barrierNodes, ...eventNodes]
  const edges: AdminSceneEdge[] = []
  const networkPaths: Array<[string, string]> = [
    ['role:attacker', 'network:jump:1'],
    ['network:jump:2', 'security:barrier:1'],
    ['security:barrier:1', 'security:barrier:2'],
    ['security:barrier:2', 'security:barrier:3'],
    ['security:barrier:3', 'security:barrier:4'],
    ['security:barrier:4', 'network:asset:1'], ['security:barrier:4', 'network:asset:2'], ['security:barrier:4', 'network:asset:3'],
    ['network:asset:1', 'role:defender'], ['network:asset:2', 'role:defender'], ['network:asset:3', 'role:defender'],
  ]
  edges.push(...networkPaths.map(([from, to], index) => ({
    id: `network-path:${index + 1}`, from, to, status: 'unknown' as const, color: '#2c9eb9', kind: 'network' as const,
  })))
  edges.push(
    { id: 'team-path:1', from: 'network:jump:1', to: 'network:jump:2', status: 'unknown', color: '#63b4ff', kind: 'network' },
    { id: 'team-path:2', from: 'network:asset:1', to: 'network:asset:2', status: 'unknown', color: '#57e8c7', kind: 'network' },
    { id: 'team-path:3', from: 'network:asset:2', to: 'network:asset:3', status: 'unknown', color: '#57e8c7', kind: 'network' },
  )
  edges.push(...eventNodes.slice(1).map((node, index) => ({
    id: `timeline:${battle.id}:${index}`,
    from: eventNodes[index].id,
    to: node.id,
    status: node.status,
    color: node.color,
    kind: 'timeline' as const,
  })))
  const eventId = new Map(orderedEvents.map(({ event, index }) => [event, `event:${battle.id}:${event.sequence ?? index + 1}:${index}`]))
  const addInteraction = (from?: AdminBattleEvent, to?: AdminBattleEvent, label = 'interaction') => {
    if (!from || !to) return
    const fromId = eventId.get(from)
    const toId = eventId.get(to)
    if (!fromId || !toId || edges.some(edge => edge.kind === 'interaction' && edge.from === fromId && edge.to === toId)) return
    const target = eventNodes.find(node => node.id === toId)
    edges.push({ id: `${label}:${battle.id}:${fromId}:${toId}`, from: fromId, to: toId, status: target?.status ?? 'unknown', color: '#f2d477', kind: 'interaction' })
  }

  const referenceFields = ['parentSequence', 'causedBySequence', 'inReplyToSequence', 'sourceSequence']
  const bySequence = new Map(orderedEvents.flatMap(({ event }) => typeof event.sequence === 'number' ? [[event.sequence, event] as const] : []))
  for (const { event } of orderedEvents) {
    for (const field of referenceFields) {
      const reference = event.data?.[field]
      const source = typeof reference === 'number' ? bySequence.get(reference) : undefined
      addInteraction(source, event, `causal-${field}`)
    }
  }

  const correlated = new Map<string, AdminBattleEvent[]>()
  const rounds = new Map<number, AdminBattleEvent[]>()
  for (let index = 0; index < orderedEvents.length; index += 1) {
    const event = orderedEvents[index].event
    const currentRole = eventActorRole(event)
    const previous = orderedEvents[index - 1]?.event
    if (previous) {
      const previousRole = eventActorRole(previous)
      if ((previousRole === 'attacker' || previousRole === 'defender') && (currentRole === 'attacker' || currentRole === 'defender') && previousRole !== currentRole) {
        addInteraction(previous, event, 'role-handoff')
      }
    }

    const round = eventRound(event)
    if (round !== undefined) rounds.set(round, [...(rounds.get(round) ?? []), event])
    const correlationId = event.data?.correlationId
    if (typeof correlationId === 'string' && correlationId) correlated.set(correlationId, [...(correlated.get(correlationId) ?? []), event])
  }
  for (const [round, roundEvents] of rounds) {
    for (let index = 1; index < roundEvents.length; index += 1) {
      const previous = roundEvents[index - 1]
      const current = roundEvents[index]
      if (eventActorRole(previous) !== eventActorRole(current)) addInteraction(previous, current, `round-${round}`)
    }
  }
  for (const [correlationId, relatedEvents] of correlated) {
    for (let index = 1; index < relatedEvents.length; index += 1) {
      addInteraction(relatedEvents[index - 1], relatedEvents[index], `correlation-${correlationId}`)
    }
  }

  const hasCrossSideAction = eventNodes.some((node) => {
    const event = node.source as AdminBattleEvent
    const explicitTarget = event.data?.targetRole
    const cue = replayEventCue(event).kind
    const targetRole = explicitTarget === 'attacker' || explicitTarget === 'defender'
      ? explicitTarget
      : cue === 'defense-request' ? 'defender'
        : cue === 'defense' ? 'attacker'
          : cue !== 'other' && cue !== 'session' && (node.actorRole === 'attacker' || node.actorRole === 'defender')
            ? node.actorRole === 'attacker' ? 'defender' : 'attacker'
            : undefined
    return (node.actorRole === 'attacker' || node.actorRole === 'defender') && targetRole !== undefined && targetRole !== node.actorRole
  })
  if (hasCrossSideAction) {
    edges.push({ id: `side-flow:${battle.id}`, from: 'role:attacker', to: 'role:defender', status: 'unknown', color: '#f2d477', kind: 'interaction' })
  }

  const eventOrder = new Map(eventNodes.map((node, index) => [node.id, index]))
  const orderedEdges = [
    ...edges.filter((edge) => edge.kind === 'network'),
    ...edges.filter((edge) => edge.kind === 'timeline'),
    ...edges.filter((edge) => edge.kind === 'interaction').sort((left, right) =>
      (eventOrder.get(left.from) ?? 0) - (eventOrder.get(right.from) ?? 0)
      || (eventOrder.get(left.to) ?? 0) - (eventOrder.get(right.to) ?? 0)),
  ]
  const attackCompleted = orderedEvents.find((item) => eventType(item.event) === 'attack.completed')?.event
  const rawSampleCount = attackCompleted?.data?.sampleCount
  const sampleCount = typeof rawSampleCount === 'number' && Number.isFinite(rawSampleCount) ? Math.max(0, Math.floor(rawSampleCount)) : undefined
  return { nodes, edges: orderedEdges, statusColors, topic: battle.topic, difficulty: battle.difficulty, sampleCount, score }
}

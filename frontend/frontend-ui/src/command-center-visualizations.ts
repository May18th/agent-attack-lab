export type BattleVisualizationRoleScore = {
  score?: number | null
  blocked?: boolean
  penetrated?: boolean
  summary?: {
    finalScore?: number | null
    responseScore?: number | null
  }
}

export type BattleVisualizationRound = {
  round: number
  status: string
  sample?: unknown
  startedAt?: string | null
  sourceType?: string | null
  attackSuccess?: boolean
  defenseSuccess?: boolean
  safeControl?: {
    status?: string
    evidence?: unknown[]
  } | null
  caught?: unknown[]
  durationMs?: number | null
  compromised?: {
    targetVerified?: boolean
    simulated?: boolean
  } | null
  attacker?: BattleVisualizationRoleScore | null
  defender?: BattleVisualizationRoleScore | null
}

export type BattleVisualizationSummary = {
  points: Array<{ round: number; attacker: number | null; defender: number | null }>
  roundCount: number
  payloadCount: number
  newSourcePayloadCount: number
  payloadUpdateRate: number
  classificationAvailable: boolean
  interceptedRounds: number | null
  escapedRounds: number | null
  classifiedRounds: number | null
  effectiveInterceptionRate: number | null
  averageResponseMs: number | null
  averageResponseScore: { attacker: number | null; defender: number | null }
}

export type BattleTimelineEvent = {
  id: string
  battleId: string
  type: string
  status: string
  sequence: number
  createdAt: string
  data: Record<string, unknown>
}

export type BattleTimelineEntry =
  | { kind: 'round'; round: number }
  | {
      kind: 'event'
      side: 'att' | 'def' | 'judge'
      event: BattleTimelineEvent
      key: string
      update: boolean
      /** penetrated：由 arbiter.layer.confirmed 合成的 ATTACKER「Ln 已穿透」卡 */
      variant?: 'penetrated'
    }

export type BattleLifecycleEvent = {
  type: string
  battleId: string
  round: number
  stageId?: string
  status?: string
  payload: Record<string, unknown>
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function roleScore(role: BattleVisualizationRoleScore | null | undefined): number | null {
  if (finiteNumber(role?.summary?.finalScore)) return role.summary.finalScore
  return finiteNumber(role?.score) ? role.score : null
}

function average(values: number[]): number | null {
  return values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) / 100
    : null
}

function percentage(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round(numerator / denominator * 10_000) / 100 : 0
}

export function buildBattleVisualizations(rounds: readonly BattleVisualizationRound[]): BattleVisualizationSummary {
  const visibleRounds = rounds
    .filter((round) => round.status !== 'pending' || Boolean(round.startedAt))
    .slice()
    .sort((left, right) => left.round - right.round)
  const completed = visibleRounds.filter((round) => round.status === 'completed')

  const classified = completed.filter((round) => (
    typeof round.attackSuccess === 'boolean'
    && typeof round.defenseSuccess === 'boolean'
    && round.attackSuccess !== round.defenseSuccess
  ))
  const classificationAvailable = classified.length > 0
  const interceptedRounds = classificationAvailable
    ? classified.filter((round) => round.attackSuccess === false && round.defenseSuccess === true).length
    : null
  const escapedRounds = classificationAvailable
    ? classified.filter((round) => round.attackSuccess === true && round.defenseSuccess === false).length
    : null
  const classifiedRounds = interceptedRounds === null || escapedRounds === null
    ? null
    : interceptedRounds + escapedRounds
  const payloadRounds = rounds.filter((round) => round.sample != null || round.sourceType != null)
  const newSourcePayloadCount = payloadRounds.filter((round) => round.sourceType === 'new-source').length
  const roundCount = visibleRounds.length
  return {
    points: visibleRounds.map((round) => ({
      round: round.round,
      attacker: roleScore(round.attacker),
      defender: roleScore(round.defender),
    })),
    roundCount,
    payloadCount: payloadRounds.length,
    newSourcePayloadCount,
    payloadUpdateRate: percentage(newSourcePayloadCount, payloadRounds.length),
    classificationAvailable,
    interceptedRounds,
    escapedRounds,
    classifiedRounds,
    effectiveInterceptionRate: interceptedRounds !== null && roundCount > 0
      ? percentage(interceptedRounds, roundCount)
      : null,
    averageResponseMs: average(completed
      .map((round) => round.durationMs)
      .filter((value): value is number => finiteNumber(value) && value >= 0)),
    averageResponseScore: {
      attacker: average(completed
        .map((round) => round.attacker?.summary?.responseScore)
        .filter(finiteNumber)),
      defender: average(completed
        .map((round) => round.defender?.summary?.responseScore)
        .filter(finiteNumber)),
    },
  }
}

export function shouldRenderBattleTimelineEvent(type: string, data: Record<string, unknown> = {}): boolean {
  const stageId = typeof data.stageId === 'string' ? data.stageId.trim().toUpperCase() : ''
  // Agent 调用是 Attacker/Defender 与后端实际执行之间的可追溯边界，
  // 必须进入时间线；同一 correlationId 的 started/completed/failed 会合并到一个框。
  if (type === 'agent.call.started' || type === 'agent.call.completed' || type === 'agent.call.failed') return true
  if (/^A[1-8]$/.test(stageId)) {
    return type === 'attack.stage.started'
      || type === 'attack.stage.completed'
      || type === 'attack.stage.failed'
      || type === 'arbiter.similarity.checked'
  }
  if (type.startsWith('arbiter.')) return true
  // 层开始卡（Arbiter 开启 Ln 层检测）必须进入时间线：它同时是 3D 释放该层标签粒子的触发点。
  if (/^L[0-3]$/.test(stageId)) return type === 'arbiter.layer.started' || type === 'defense.layer.started'
  if (/^L[0-3]-\d+$/.test(stageId)) {
    return type === 'defense.check.started' || type === 'defense.layer.verdict'
  }
  return type === 'defense.safe_control'
    || type === 'round.settled'
    || type === 'battle.completed'
    || type === 'battle.failed'
}

function logicalTimelineStage(type: string, stageId: string, data: Record<string, unknown> = {}): string {
  if (type === 'agent.call.started' || type === 'agent.call.completed' || type === 'agent.call.failed') {
    return `agent-call:${String(stageId || 'agent').toUpperCase()}:${String(data.correlationId || '')}`
  }
  if (/^A[1-8]$/.test(stageId)) return `attacker:${stageId}`
  if (/^L[0-3]-\d+$/.test(stageId)) return `defender:${stageId}`
  if (type === 'arbiter.layer.started' || type === 'arbiter.layer.confirmed' || type === 'defense.layer.started') {
    return `arbiter-layer:${stageId || 'unknown'}`
  }
  if (type === 'arbiter.similarity.checked') return 'arbiter:A6'
  if (type === 'arbiter.safe_control.started' || type === 'arbiter.safe_control') return 'arbiter:safe-control'
  if (type === 'arbiter.safe_control.verdict') return 'arbiter:safe-control-verdict'
  if (type === 'defense.safe_control') return 'defender:safe-control'
  if (type === 'arbiter.verdict') return 'arbiter:verdict'
  if (type === 'arbiter.round.score' || type === 'arbiter.round.scored') return 'arbiter:round-score'
  if (type === 'round.settled') return 'arbiter:round-settled'
  if (type === 'battle.completed' || type === 'battle.failed') return 'arbiter:battle-settled'
  return `${type}:${stageId || 'event'}`
}

export class LiveBattleTimelineProjector {
  private readonly renderedRounds = new Set<number>()
  private readonly renderedStages = new Set<string>()
  /** 每回合最终分类：安全对照事件卡只在完整穿透（full-penetration）回合出现 */
  private readonly roundClassification = new Map<number, string>()
  /** 已出过「Ln 已穿透」卡的层（key = battleId:round:layerIndex） */
  private readonly penetrated = new Set<string>()

  private isSafeControlEvent(type: string): boolean {
    return type === 'arbiter.safe_control.started'
      || type === 'arbiter.safe_control'
      || type === 'arbiter.safe_control.verdict'
      || type === 'defense.safe_control'
  }

  push(event: BattleTimelineEvent): BattleTimelineEntry[] {
    const round = Number(event.data.round || 0)
    const entries: BattleTimelineEntry[] = []
    const classification = typeof event.data.classification === 'string' ? event.data.classification : ''
    if ((event.type === 'arbiter.verdict' || event.type === 'round.settled') && classification) {
      this.roundClassification.set(round, classification)
    }
    if (!shouldRenderBattleTimelineEvent(event.type, event.data)) return entries
    // 只有完整穿透回合才展示安全对照（启动安全对照 / D-07 结果 / 特征库动作）事件卡
    if (this.isSafeControlEvent(event.type) && this.roundClassification.get(round) !== 'full-penetration') return entries
    if (round > 0 && !this.renderedRounds.has(round)) {
      this.renderedRounds.add(round)
      entries.push({ kind: 'round', round })
    }
    // 「Ln 已穿透」卡片的触发点：更内层开始检测，或 Arbiter 正式确认该层。
    // 后端只在「该层全部通过 + 拿到该层证据 ID」时才发 arbiter.layer.confirmed，
    // 因此必须允许由「下一层开始检测」推出上一层已穿透，否则这张卡几乎永远不出现。
    const layerIndex = Number(event.data.layerIndex)
    let confirmedPenetration: BattleTimelineEntry | null = null
    if (round > 0 && Number.isFinite(layerIndex) && layerIndex >= 0 && layerIndex <= 3) {
      const penetrate = (li: number): BattleTimelineEntry | null => {
        const key = `${event.battleId}:${round}:${li}`
        if (this.penetrated.has(key)) return null
        this.penetrated.add(key)
        return {
          kind: 'event',
          side: 'att',
          event: {
            ...event,
            id: `${event.id}-penetrated-${li}`,
            type: 'defense.layer.penetrated',
            data: { ...event.data, stageId: `L${li}`, layerIndex: li },
          },
          key: `${key}:penetrated`,
          update: false,
          variant: 'penetrated',
        }
      }
      // 更内层开始检测 => 上一层已穿透：卡片排在「开启层检测」卡之前
      if (event.type === 'defense.layer.started' && layerIndex > 0) {
        const entry = penetrate(layerIndex - 1)
        if (entry) entries.push(entry)
      }
      // Arbiter 确认 => 卡片排在该层确认卡之后
      if (event.type === 'arbiter.layer.confirmed') confirmedPenetration = penetrate(layerIndex)
    }
    const stageId = String(event.data.stageId || '').trim().toUpperCase()
    const stageKey = `${event.battleId}:${round}:${logicalTimelineStage(event.type, stageId, event.data)}`
    const update = this.renderedStages.has(stageKey)
    this.renderedStages.add(stageKey)
    const agentRole = String(event.data.agentRole || '').trim().toLowerCase()
    const side = event.type.startsWith('arbiter.') || stageId === 'A6' ? 'judge'
      : event.type === 'round.settled' || event.type === 'battle.completed' || event.type === 'battle.failed' ? 'judge'
      : event.type.startsWith('agent.call.') && agentRole === 'defender' ? 'def'
      : event.type.startsWith('agent.call.') && agentRole === 'attacker' ? 'att'
      : /^A[1-8]$/.test(stageId) ? 'att' : 'def'
    entries.push({ kind: 'event', side, event, key: stageKey, update })
    if (confirmedPenetration) entries.push(confirmedPenetration)
    return entries
  }
}

function lifecycleEvent(
  event: BattleTimelineEvent,
  type: string,
  payload: Record<string, unknown> = {},
  stageId?: string,
  status?: string,
): BattleLifecycleEvent {
  return {
    type,
    battleId: event.battleId,
    round: Number(event.data.round || 0),
    ...(stageId ? { stageId } : {}),
    ...(status ? { status } : {}),
    payload,
  }
}

function sampleId(sample: unknown): string | undefined {
  if (!sample || typeof sample !== 'object') return undefined
  const value = (sample as Record<string, unknown>).testCaseId
    ?? (sample as Record<string, unknown>).sampleId
  return typeof value === 'string' && value ? value : undefined
}

/** Buffers batched attacker samples until their matching round starts. */
export class LiveBattleLifecycleProjector {
  private readonly pendingSamples = new Map<string, BattleTimelineEvent>()

  push(event: BattleTimelineEvent): BattleLifecycleEvent[] {
    const round = Number(event.data.round || 0)
    const key = `${event.battleId}:${round}`
    const stageId = typeof event.data.stageId === 'string' ? event.data.stageId : undefined
    if (event.type === 'attack.stage.started') {
      return [lifecycleEvent(event, 'stage_started', event.data, stageId)]
    }
    if (event.type === 'attack.stage.completed') {
      return [lifecycleEvent(event, 'stage_completed', event.data, stageId, event.data.classification as string | undefined)]
    }
    if (event.type === 'attack.stage.failed') {
      return [lifecycleEvent(event, 'stage_failed', event.data, stageId, 'failed')]
    }
    if (event.type === 'defense.layer.started') {
      return [lifecycleEvent(event, 'layer_started', event.data, stageId)]
    }
    if (event.type === 'defense.check.started') {
      return [lifecycleEvent(event, 'stage_started', event.data, stageId)]
    }
    if (event.type === 'defense.layer.verdict') {
      return [lifecycleEvent(event, 'layer_verdict', event.data, stageId, event.status)]
    }
    if (event.type === 'arbiter.layer.confirmed') {
      return [lifecycleEvent(event, 'arbiter_layer_confirm', event.data, stageId, event.status)]
    }
    if (event.type === 'arbiter.similarity.checked') {
      return [lifecycleEvent(event, 'stage_completed', event.data, 'A6', event.status)]
    }
    if (event.type === 'arbiter.verdict') {
      return [lifecycleEvent(event, 'arbiter_verdict', event.data, stageId, event.status)]
    }
    if (event.type === 'round.settled') {
      return [lifecycleEvent(event, 'round_settled', event.data, stageId, event.status)]
    }
    if (event.type === 'defense.safe_control') {
      return [lifecycleEvent(event, 'safe_control', event.data, stageId, event.status)]
    }
    if (event.type === 'arbiter.safe_control.verdict') {
      return [lifecycleEvent(event, 'safe_control_verdict', event.data, stageId, event.status)]
    }
    if (event.type === 'attack.sample.generated' && round > 0) {
      this.pendingSamples.set(key, event)
      return []
    }
    if (event.type === 'battle.completed' || event.type === 'battle.failed') {
      this.pendingSamples.clear()
      return [lifecycleEvent(event, 'battle_ended', event.data)]
    }
    if (event.type === 'round.completed' && round > 0) {
      if (event.data.structuredTimelineVersion === 'v2.0') return []
      return this.projectDefense(event)
    }
    if (event.type !== 'round.started' || round <= 0) return []

    const output: BattleLifecycleEvent[] = [
      lifecycleEvent(event, 'round_started', { round }),
    ]
    const sample = this.pendingSamples.get(key)
    this.pendingSamples.delete(key)
    if (!sample || event.data.structuredTimelineVersion === 'v2.0') return output

    const id = sampleId(sample.data.sample)
    const payload = id ? { sampleId: id } : {}
    for (const stageId of ['A2', 'A3', 'A4', 'A5', 'A6', 'A7']) {
      output.push(lifecycleEvent(sample, 'stage_started', payload, stageId))
      output.push(lifecycleEvent(sample, 'stage_completed', payload, stageId, 'passed'))
    }
    return output
  }

  private projectDefense(event: BattleTimelineEvent): BattleLifecycleEvent[] {
    const classification = event.data.classification
    const output: BattleLifecycleEvent[] = []
    if (classification === 'blocked') {
      output.push(lifecycleEvent(event, 'layer_started', { layerIndex: 0 }, 'L0-1'))
      output.push(lifecycleEvent(event, 'stage_started', {}, 'L0-1'))
      output.push(lifecycleEvent(event, 'layer_verdict', { status: 'blocked' }, 'L0-1', 'blocked'))
      output.push(lifecycleEvent(event, 'round_settled', { classification }))
      return output
    }
    if (classification !== 'passed') return output

    const checks = [['L0-1', 'L0-2', 'L0-3'], ['L1-1', 'L1-2', 'L1-3'], ['L2-1', 'L2-2', 'L2-3', 'L2-4', 'L2-5'], ['L3-1', 'L3-2', 'L3-3', 'L3-4']]
    checks.forEach((layer, layerIndex) => {
      output.push(lifecycleEvent(event, 'layer_started', { layerIndex }, layer[0]))
      layer.forEach((stageId) => {
        output.push(lifecycleEvent(event, 'stage_started', {}, stageId))
        output.push(lifecycleEvent(event, 'layer_verdict', { status: 'passed' }, stageId, 'passed'))
      })
      output.push(lifecycleEvent(event, 'arbiter_layer_confirm', { layerIndex }))
    })
    output.push(lifecycleEvent(event, 'arbiter_verdict', { classification: 'unresolved' }))
    output.push(lifecycleEvent(event, 'round_settled', { classification: 'passed' }))
    return output
  }
}

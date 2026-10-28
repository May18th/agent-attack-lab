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
  | { kind: 'event'; side: 'att' | 'def' | 'judge'; event: BattleTimelineEvent }

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

export function buildBattleVisualizations(rounds: readonly BattleVisualizationRound[]): BattleVisualizationSummary {
  const completed = rounds
    .filter((round) => round.status === 'completed')
    .slice()
    .sort((left, right) => left.round - right.round)

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
  return {
    points: completed.map((round) => ({
      round: round.round,
      attacker: roleScore(round.attacker),
      defender: roleScore(round.defender),
    })),
    classificationAvailable,
    interceptedRounds,
    escapedRounds,
    classifiedRounds,
    effectiveInterceptionRate: interceptedRounds !== null && classifiedRounds !== null && classifiedRounds > 0
      ? interceptedRounds / classifiedRounds * 100
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
  if (type.startsWith('arbiter.')) return true
  if (type === 'defense.safe_control') return true
  const stageId = typeof data.stageId === 'string' ? data.stageId.trim().toUpperCase() : ''
  // The primary timeline is a result timeline: one card per logical stage.
  // Started events remain available to the role log and 3D animation stream.
  if (/^A[1-8]$/.test(stageId)) return type === 'attack.stage.completed'
  if (/^L[0-3]$/.test(stageId)) return false
  if (/^L[0-3]-\d+$/.test(stageId)) {
    return type === 'defense.layer.verdict'
  }
  return false
}

export class LiveBattleTimelineProjector {
  private readonly renderedRounds = new Set<number>()
  private readonly renderedStages = new Set<string>()

  push(event: BattleTimelineEvent): BattleTimelineEntry[] {
    const round = Number(event.data.round || 0)
    const entries: BattleTimelineEntry[] = []
    if (!shouldRenderBattleTimelineEvent(event.type, event.data)) return entries
    if (round > 0 && !this.renderedRounds.has(round)) {
      this.renderedRounds.add(round)
      entries.push({ kind: 'round', round })
    }
    const stageId = String(event.data.stageId || '').trim().toUpperCase()
    const stageKey = `${event.battleId}:${round}:${stageId}:${event.type.startsWith('arbiter.') ? event.type : 'stage'}`
    if (stageId && this.renderedStages.has(stageKey)) return entries
    if (stageId) this.renderedStages.add(stageKey)
    const side = event.type.startsWith('arbiter.') || stageId === 'A6' ? 'judge'
      : /^A[1-8]$/.test(stageId) ? 'att' : 'def'
    entries.push({ kind: 'event', side, event })
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

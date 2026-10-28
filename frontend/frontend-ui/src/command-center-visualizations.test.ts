import { describe, expect, it } from 'vitest'
import { buildBattleVisualizations, LiveBattleLifecycleProjector, LiveBattleTimelineProjector, shouldRenderBattleTimelineEvent, type BattleTimelineEvent } from './command-center-visualizations'

describe('live battle visualizations', () => {
  it('uses completed round evidence and keeps missing scores distinct from zero', () => {
    const result = buildBattleVisualizations([
      {
        round: 1,
        status: 'completed',
        caught: [{ ruleId: 'LAB-PROMPT-001' }],
        durationMs: 1000,
        attacker: { score: 72.5, penetrated: false, summary: { finalScore: 72.5, responseScore: 20 } },
        defender: { score: 84, blocked: true, summary: { finalScore: 84, responseScore: 60 } },
      },
      {
        round: 2,
        status: 'completed',
        caught: [],
        durationMs: 3000,
        compromised: { targetVerified: true, simulated: true },
        attacker: { score: null, penetrated: false, summary: { finalScore: null, responseScore: 40 } },
        defender: { score: null, blocked: false, summary: { finalScore: null, responseScore: 80 } },
      },
      {
        round: 3,
        status: 'completed',
        caught: [],
        compromised: { targetVerified: true, simulated: false },
        attacker: { score: null, penetrated: true, summary: { finalScore: null, responseScore: null } },
        defender: { score: null, blocked: false, summary: { finalScore: null, responseScore: null } },
      },
      {
        round: 4,
        status: 'running',
        durationMs: 9000,
        attacker: { score: 100, summary: { finalScore: 100, responseScore: 100 } },
        defender: { score: 100, summary: { finalScore: 100, responseScore: 100 } },
      },
      {
        round: 5,
        status: 'completed',
        caught: [{ ruleId: 'LAB-LEGACY-ONLY' }],
        compromised: { targetVerified: true, simulated: false },
        attacker: { score: 50, summary: { finalScore: 50, responseScore: 50 } },
        defender: { score: 50, summary: { finalScore: 50, responseScore: 50 } },
      },
    ])

    expect(result).toEqual({
      points: [
        { round: 1, attacker: 72.5, defender: 84 },
        { round: 2, attacker: null, defender: null },
        { round: 3, attacker: null, defender: null },
        { round: 5, attacker: 50, defender: 50 },
      ],
      classificationAvailable: false,
      interceptedRounds: null,
      escapedRounds: null,
      classifiedRounds: null,
      effectiveInterceptionRate: null,
      averageResponseMs: 2000,
      averageResponseScore: { attacker: 36.67, defender: 63.33 },
    })
  })

  it('classifies only explicit backend booleans and never derives outcomes from caught or compromise data', () => {
    const result = buildBattleVisualizations([
      { round: 1, status: 'completed', caught: [{}], defender: { blocked: true }, attacker: { penetrated: false } },
      { round: 2, status: 'completed', compromised: { targetVerified: true }, defender: { blocked: false }, attacker: { penetrated: true } },
      { round: 3, status: 'completed', caught: [{}], defender: {}, attacker: {} },
    ])

    expect(result).toMatchObject({
      classificationAvailable: false,
      interceptedRounds: null,
      escapedRounds: null,
      effectiveInterceptionRate: null,
    })
  })

  it('classifies interception and escape from explicit v2.0 Arbiter truth fields', () => {
    const result = buildBattleVisualizations([
      { round: 1, status: 'completed', attackSuccess: false, defenseSuccess: true },
      { round: 2, status: 'completed', attackSuccess: true, defenseSuccess: false },
      { round: 3, status: 'completed', safeControl: { status: 'passed', evidence: ['safe-3'] } },
    ])

    expect(result).toMatchObject({
      classificationAvailable: true,
      interceptedRounds: 1,
      escapedRounds: 1,
      classifiedRounds: 2,
      effectiveInterceptionRate: 50,
    })
  })

  it('limits the primary timeline to canonical attacker, defender, and Arbiter events', () => {
    expect(shouldRenderBattleTimelineEvent('attack.stage.started', { stageId: 'A1' })).toBe(false)
    expect(shouldRenderBattleTimelineEvent('attack.stage.completed', { stageId: 'A8' })).toBe(true)
    expect(shouldRenderBattleTimelineEvent('defense.layer.started', { stageId: 'L0' })).toBe(true)
    expect(shouldRenderBattleTimelineEvent('defense.check.started', { stageId: 'L0-1' })).toBe(false)
    expect(shouldRenderBattleTimelineEvent('defense.layer.verdict', { stageId: 'L3-4' })).toBe(true)
    expect(shouldRenderBattleTimelineEvent('arbiter.similarity.checked', { stageId: 'A6' })).toBe(true)
    expect(shouldRenderBattleTimelineEvent('arbiter.layer.confirmed', { stageId: 'L0' })).toBe(true)
    expect(shouldRenderBattleTimelineEvent('arbiter.verdict', { stageId: 'ARBITER' })).toBe(true)
    expect(shouldRenderBattleTimelineEvent('agent.call.completed', { stageId: 'A1' })).toBe(false)
    expect(shouldRenderBattleTimelineEvent('round.started', { round: 1 })).toBe(false)
    expect(shouldRenderBattleTimelineEvent('attack.sample.generated', { round: 1 })).toBe(false)
    expect(shouldRenderBattleTimelineEvent('battle.completed')).toBe(false)
  })

  it('groups only canonical events into their round and excludes lifecycle and sample events', () => {
    const projector = new LiveBattleTimelineProjector()
    const event = (type: string, sequence: number, round?: number, extra: Record<string, unknown> = {}): BattleTimelineEvent => ({
      id: `event-${sequence}`,
      battleId: 'battle-1',
      type,
      sequence,
      status: 'completed',
      createdAt: `2026-10-26T00:00:0${sequence}Z`,
      data: { ...(round ? { round } : {}), ...extra },
    })

    expect(projector.push(event('attack.sample.generated', 1, 1))).toEqual([])
    expect(projector.push(event('attack.sample.generated', 2, 2))).toEqual([])
    expect(projector.push(event('agent.call.completed', 3, undefined, { agentRole: 'attacker' }))).toEqual([])
    expect(projector.push(event('round.started', 4, 1))).toEqual([])
    expect(projector.push(event('attack.stage.started', 5, 1, { stageId: 'A1' }))).toEqual([])
    expect(projector.push(event('attack.stage.completed', 6, 1, { stageId: 'A1' }))).toEqual([
      { kind: 'round', round: 1 },
      { kind: 'event', side: 'att', event: event('attack.stage.completed', 6, 1, { stageId: 'A1' }) },
    ])
    expect(projector.push(event('round.completed', 7, 1))).toEqual([])
    expect(projector.push(event('defense.layer.started', 7, 2, { stageId: 'L0' }))).toEqual([
      { kind: 'round', round: 2 },
      { kind: 'event', side: 'def', event: event('defense.layer.started', 7, 2, { stageId: 'L0' }) },
    ])
    expect(projector.push(event('defense.check.started', 8, 2, { stageId: 'L0-1' }))).toEqual([])
  })

  it('places Arbiter events centrally even when they carry an L-layer stage id', () => {
    const projector = new LiveBattleTimelineProjector()
    const event = (type: string, sequence: number, round: number, data: Record<string, unknown>): BattleTimelineEvent => ({
      id: `event-${sequence}`,
      battleId: 'battle-1',
      type,
      sequence,
      status: 'completed',
      createdAt: `2026-10-26T00:00:0${sequence}Z`,
      data: { round, ...data },
    })

    expect(projector.push(event('arbiter.layer.confirmed', 1, 1, { stageId: 'L0' }))).toEqual([
      { kind: 'round', round: 1 },
      { kind: 'event', side: 'judge', event: event('arbiter.layer.confirmed', 1, 1, { stageId: 'L0' }) },
    ])
  })

  it('keeps the Arbiter confirmation card when the defender already opened that layer', () => {
    const projector = new LiveBattleTimelineProjector()
    const event = (type: string, sequence: number, data: Record<string, unknown>): BattleTimelineEvent => ({
      id: `event-${sequence}`,
      battleId: 'battle-1',
      type,
      sequence,
      status: 'completed',
      createdAt: `2026-10-26T00:00:0${sequence}Z`,
      data: { round: 1, ...data },
    })

    projector.push(event('defense.layer.started', 1, { stageId: 'L0' }))
    expect(projector.push(event('arbiter.layer.confirmed', 2, { stageId: 'L0' }))).toEqual([
      { kind: 'event', side: 'judge', event: event('arbiter.layer.confirmed', 2, { stageId: 'L0' }) },
    ])
  })

  it('does not add battle lifecycle events when there are no canonical stages', () => {
    const projector = new LiveBattleTimelineProjector()
    const sample: BattleTimelineEvent = {
      id: 'sample-1', battleId: 'battle-1',
      type: 'attack.sample.generated', sequence: 1, status: 'completed',
      createdAt: '2026-10-26T00:00:01Z', data: { round: 1 },
    }
    const failed: BattleTimelineEvent = {
      id: 'failed-2', battleId: 'battle-1',
      type: 'battle.failed', sequence: 2, status: 'failed',
      createdAt: '2026-10-26T00:00:02Z', data: { error: 'failed' },
    }

    expect(projector.push(sample)).toEqual([])
    expect(projector.push(failed)).toEqual([])
  })

  it('projects backend rounds into the lifecycle events consumed by the attack animation', () => {
    const projector = new LiveBattleLifecycleProjector()
    const event = (type: string, sequence: number, round?: number, data: Record<string, unknown> = {}): BattleTimelineEvent => ({
      id: `event-${sequence}`,
      battleId: 'battle-1',
      type,
      sequence,
      status: 'completed',
      createdAt: `2026-10-26T00:00:0${sequence}Z`,
      data: { ...(round ? { round } : {}), ...data },
    })

    expect(projector.push(event('attack.sample.generated', 1, 1, {
      sample: { testCaseId: 'sample-1' },
    }))).toEqual([])
    expect(projector.push(event('round.started', 2, 1))).toEqual([
      { type: 'round_started', battleId: 'battle-1', round: 1, payload: { round: 1 } },
      { type: 'stage_started', battleId: 'battle-1', round: 1, stageId: 'A2', payload: { sampleId: 'sample-1' } },
      { type: 'stage_completed', battleId: 'battle-1', round: 1, stageId: 'A2', status: 'passed', payload: { sampleId: 'sample-1' } },
      { type: 'stage_started', battleId: 'battle-1', round: 1, stageId: 'A3', payload: { sampleId: 'sample-1' } },
      { type: 'stage_completed', battleId: 'battle-1', round: 1, stageId: 'A3', status: 'passed', payload: { sampleId: 'sample-1' } },
      { type: 'stage_started', battleId: 'battle-1', round: 1, stageId: 'A4', payload: { sampleId: 'sample-1' } },
      { type: 'stage_completed', battleId: 'battle-1', round: 1, stageId: 'A4', status: 'passed', payload: { sampleId: 'sample-1' } },
      { type: 'stage_started', battleId: 'battle-1', round: 1, stageId: 'A5', payload: { sampleId: 'sample-1' } },
      { type: 'stage_completed', battleId: 'battle-1', round: 1, stageId: 'A5', status: 'passed', payload: { sampleId: 'sample-1' } },
      { type: 'stage_started', battleId: 'battle-1', round: 1, stageId: 'A6', payload: { sampleId: 'sample-1' } },
      { type: 'stage_completed', battleId: 'battle-1', round: 1, stageId: 'A6', status: 'passed', payload: { sampleId: 'sample-1' } },
      { type: 'stage_started', battleId: 'battle-1', round: 1, stageId: 'A7', payload: { sampleId: 'sample-1' } },
      { type: 'stage_completed', battleId: 'battle-1', round: 1, stageId: 'A7', status: 'passed', payload: { sampleId: 'sample-1' } },
    ])
  })

  it('projects explicit defense evidence into layer checks without inventing a verdict', () => {
    const projector = new LiveBattleLifecycleProjector()
    const event = (type: string, sequence: number, data: Record<string, unknown> = {}): BattleTimelineEvent => ({
      id: `event-${sequence}`,
      battleId: 'battle-1',
      type,
      sequence,
      status: 'completed',
      createdAt: `2026-10-26T00:00:0${sequence}Z`,
      data: { round: 1, ...data },
    })

    expect(projector.push(event('round.started', 1))).toHaveLength(1)
    const entries = projector.push(event('round.completed', 2, {
      classification: 'blocked',
      caught: [{ ruleId: 'D-06' }],
    }))
    expect(entries).toEqual([
      { type: 'layer_started', battleId: 'battle-1', round: 1, stageId: 'L0-1', payload: { layerIndex: 0 } },
      { type: 'stage_started', battleId: 'battle-1', round: 1, stageId: 'L0-1', payload: {} },
      { type: 'layer_verdict', battleId: 'battle-1', round: 1, stageId: 'L0-1', status: 'blocked', payload: { status: 'blocked' } },
      { type: 'round_settled', battleId: 'battle-1', round: 1, payload: { classification: 'blocked' } },
    ])
  })

  it('forwards the backend v2 lifecycle without synthesizing duplicate stages', () => {
    const projector = new LiveBattleLifecycleProjector()
    const event = (
      type: string,
      sequence: number,
      data: Record<string, unknown>,
      status = 'completed',
    ): BattleTimelineEvent => ({
      id: `event-${sequence}`,
      battleId: 'battle-v2',
      type,
      sequence,
      status,
      createdAt: `2026-10-28T00:00:${String(sequence).padStart(2, '0')}Z`,
      data: { round: 1, ...data },
    })

    expect(projector.push(event('attack.sample.generated', 1, {
      sample: { testCaseId: 'sample-v2' },
    }))).toEqual([])
    expect(projector.push(event('round.started', 2, {
      structuredTimelineVersion: 'v2.0',
    }))).toEqual([
      { type: 'round_started', battleId: 'battle-v2', round: 1, payload: { round: 1 } },
    ])
    expect(projector.push(event('attack.stage.started', 3, { stageId: 'A1' }, 'running')))
      .toEqual([expect.objectContaining({ type: 'stage_started', stageId: 'A1' })])
    expect(projector.push(event('defense.layer.started', 4, {
      stageId: 'L0', layerIndex: 0, applicableChecks: ['L0-1'],
    }, 'running'))).toEqual([
      expect.objectContaining({ type: 'layer_started', stageId: 'L0' }),
    ])
    expect(projector.push(event('arbiter.verdict', 5, {
      stageId: 'ARBITER', classification: 'unresolved',
    }))).toEqual([
      expect.objectContaining({ type: 'arbiter_verdict' }),
    ])
    expect(projector.push(event('round.settled', 6, {
      stageId: 'FINAL', classification: 'unresolved',
    }))).toEqual([
      expect.objectContaining({ type: 'round_settled' }),
    ])
    expect(projector.push(event('round.completed', 7, {
      structuredTimelineVersion: 'v2.0', classification: 'unresolved',
    }))).toEqual([])
  })
})

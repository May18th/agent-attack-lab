import { describe, expect, it } from 'vitest'
import type { AdminBattle, AdminBattleEvent, AdminMetrics } from '../adminApi'
import type { ExternalCase } from '../api'
import { buildAdminSceneModel, buildBattleTimelineSceneModel, eventFlowLabel, replayEventCue, replayEventSummary } from './sceneModel'

const battle = (id: string, status: string, createdAt: string): AdminBattle => ({
  id, status, createdAt, topic: id, difficulty: 'mid', attackerOut: { samples: [] }, defenderOut: [],
})

describe('buildAdminSceneModel', () => {
  it('maps replay event types to short audience-facing cues', () => {
    expect(replayEventCue({ type: 'attack.probe.started' }).label).toBe('扫描探测')
    expect(replayEventCue({ type: 'attack.started' }).label).toBe('发起攻击')
    expect(replayEventCue({ type: 'attack.exploit.started' }).label).toBe('漏洞利用')
    expect(replayEventCue({ type: 'attack.compromised' }).label).toBe('节点沦陷')
    expect(replayEventCue({ type: 'session.established' }).label).toBe('建立会话')
    expect(replayEventCue({ type: 'battle.failed' }).color).toBe('#ff4e64')
  })

  it('maps defender round results to a visible two-way feedback cue and evidence summary', () => {
    const result: AdminBattleEvent = {
      sequence: 3, type: 'round.completed', data: {
        round: 1, caught: [{ ruleId: 'LAB-PROMPT-001' }], risks: [{ level: 'medium' }], fixed: [{ action: '建议验证' }],
        verificationStatus: '命中 1 条样本规则；真实目标未验证',
      },
    }

    expect(replayEventCue(result)).toMatchObject({ kind: 'defense', label: '防守命中 1 项', color: '#57e8c7' })
    expect(replayEventSummary(result)).toBe('防守方完成第 1 轮检测：命中 1 条样本规则，记录 1 项风险和 1 条验证建议。真实目标未验证，不能据此判定沦陷。')
    expect(replayEventSummary({ type: 'round.completed', data: { round: 2, caught: [], risks: [], fixed: [] } })).toContain('未命中当前规则')
  })

  it('describes why the replay completed or failed without implying attack efficacy', () => {
    const events: AdminBattleEvent[] = [
      { type: 'attack.sample.generated', data: { round: 1, sample: { content: 'sample' } } },
      { type: 'round.completed', data: { round: 1, caught: [{ ruleId: 'LAB-1' }], risks: [{ level: 'high' }], fixed: [{ action: '建议验证' }] } },
      { type: 'battle.completed', status: 'completed' },
    ]

    expect(replayEventSummary(events[2], events)).toBe('流程成功完成：生成 1 份攻击样本，防守完成 1 轮检测（命中 1 条规则、记录 1 项风险、提出 1 条验证建议）。真实目标未验证，不能据此判定沦陷；这是样本分析流程结果，不代表攻击成功。')
    expect(replayEventSummary({ type: 'battle.failed', data: { error: '防守调用超时' } }, events)).toContain('流程中断：防守调用超时')
    expect(replayEventSummary({ type: 'battle.failed' }, [])).toContain('记录中未提供失败原因，无法确定具体中断环节')
  })

  it('shows the attack sample moving to defense, then the defense result returning to the attacker', () => {
    const sample: AdminBattleEvent = { type: 'attack.sample.generated', data: { round: 1 } }
    const started: AdminBattleEvent = { type: 'round.started', data: { round: 1 } }
    const completed: AdminBattleEvent = { type: 'round.completed', data: { round: 1, caught: [], risks: [], fixed: [] } }

    expect(eventFlowLabel(started, sample, completed)).toBe('攻击方 → 防守方')
    expect(eventFlowLabel(completed, started)).toBe('防守方 → 攻击方')
  })

  it('labels correlated agent-call progress inside both attacking and defending sides', () => {
    const attackerStarted: AdminBattleEvent = { type: 'agent.call.started', data: { agentRole: 'attacker', correlationId: 'attacker-call' } }
    const attackerCompleted: AdminBattleEvent = { type: 'agent.call.completed', data: { agentRole: 'attacker', correlationId: 'attacker-call' } }
    const defenderStarted: AdminBattleEvent = { type: 'agent.call.started', data: { agentRole: 'defender', correlationId: 'defender-call' } }
    const defenderCompleted: AdminBattleEvent = { type: 'agent.call.completed', data: { agentRole: 'defender', correlationId: 'defender-call' } }

    expect(eventFlowLabel(attackerCompleted, attackerStarted)).toBe('攻击方内部调用：发起 → 完成')
    expect(eventFlowLabel(defenderCompleted, defenderStarted)).toBe('防守方内部调用：发起 → 完成')
  })

  it('does not claim real compromise from a completed sample analysis', () => {
    const completed: AdminBattleEvent = { type: 'battle.completed', status: 'completed' }
    const events: AdminBattleEvent[] = [
      { type: 'attack.sample.generated', data: { round: 1, sample: { content: 'sample' } } },
      { type: 'round.completed', data: { round: 1, caught: [{ ruleId: 'LAB-PROMPT-001' }], risks: [], fixed: [] } },
    ]

    expect(replayEventSummary(completed, events)).toContain('真实目标未验证，不能据此判定沦陷')
    expect(replayEventSummary({ type: 'attack.compromised', data: { targetVerified: false } })).toContain('未提供真实目标验证证据')
    expect(replayEventSummary({ type: 'attack.compromised', data: { targetVerified: true } })).toContain('已记录目标验证沦陷')
  })

  it('creates fixed role and scheduler nodes, status-colored battle nodes, and standalone case nodes', () => {
    const cases: ExternalCase[] = [{ externalId: 'CVE-1', vendorProject: 'v', product: 'p', title: 'case', dateAdded: '2026-01-01', description: '', requiredAction: '', cwes: [], sourceUrl: 'https://example.test', provenanceStatus: 'verified', synthetic: false, recordKind: 'catalog', source: { publisher: 'p', sourceType: 'feed', catalogVersion: '1', retrievedAt: '2026-01-01', contentSha256: 'abcdef' } }]
    const model = buildAdminSceneModel({ battles: [battle('b1', 'running', '2026-01-01'), battle('b2', 'completed', '2026-01-02')], metrics: {} as AdminMetrics, externalCases: cases })
    expect(model.nodes.map(node => node.kind)).toEqual(expect.arrayContaining(['attacker', 'defender', 'scheduler', 'battle', 'external-case']))
    expect(model.nodes.find(node => node.id === 'battle:b1')?.color).toBe(model.statusColors.running)
    expect(model.edges.some(edge => edge.from === 'case:CVE-1' || edge.to === 'case:CVE-1')).toBe(false)
    expect(model.edges.filter(edge => edge.from === 'role:scheduler').map(edge => edge.to)).toEqual(['battle:b1'])
  })

  it('supports empty input and caps output at 64 nodes and 128 edges', () => {
    expect(buildAdminSceneModel({ battles: [], metrics: {}, externalCases: [] }).nodes).toHaveLength(3)
    const battles = Array.from({ length: 80 }, (_, index) => battle(`b${index}`, 'completed', new Date(2026, 0, index + 1).toISOString()))
    const model = buildAdminSceneModel({ battles, metrics: {}, externalCases: [] })
    expect(model.nodes.length).toBeLessThanOrEqual(64)
    expect(model.edges.length).toBeLessThanOrEqual(128)
    expect(model.nodes.some(node => node.id === 'battle:b79')).toBe(true)
  })

  it('keeps active battles ahead of newer terminal battles when truncating', () => {
    const battles = Array.from({ length: 70 }, (_, index) => battle(`old-${index}`, 'failed', new Date(2025, 0, index + 1).toISOString()))
    battles.push(battle('active-old', 'running', '2024-01-01T00:00:00Z'))
    const model = buildAdminSceneModel({ battles, metrics: {}, externalCases: [] })
    expect(model.nodes.some(node => node.id === 'battle:active-old')).toBe(true)
    expect(model.nodes.some(node => node.id === 'battle:old-0')).toBe(false)
  })

  it('spaces battle nodes in readable lanes between the attacker and defender', () => {
    const battles = Array.from({ length: 10 }, (_, index) => battle(`lane-${index}`, 'completed', `2026-01-${String(index + 1).padStart(2, '0')}`))
    const model = buildAdminSceneModel({ battles, metrics: {}, externalCases: [] })
    const nodes = model.nodes.filter(node => node.kind === 'battle')

    expect(nodes.slice(0, 3).map(node => node.position)).toEqual([
      [-2.4, 0, 2.8], [0, 0, 2.8], [2.4, 0, 2.8],
    ])
    expect(nodes[3].position[2]).toBeLessThan(nodes[0].position[2])
    expect(nodes[9].position[2]).toBeLessThan(nodes[6].position[2])
  })

  it('keeps the newest external cases when shuffled input exceeds node capacity', () => {
    const datedCases: ExternalCase[] = Array.from({ length: 70 }, (_, index) => ({
      externalId: `CVE-${index}`, vendorProject: 'v', product: 'p', title: `case-${index}`,
      dateAdded: new Date(Date.UTC(2026, 0, index + 1)).toISOString(), description: '', requiredAction: '',
      cwes: [], sourceUrl: 'https://example.test', provenanceStatus: 'verified', synthetic: false, recordKind: 'catalog',
      source: { publisher: 'p', sourceType: 'feed', catalogVersion: '1', retrievedAt: '2026-01-01', contentSha256: 'abcdef' },
    }))
    const cases = [...datedCases.filter((_, index) => index % 2 === 0), ...datedCases.filter((_, index) => index % 2 === 1)]
    const model = buildAdminSceneModel({ battles: [], metrics: {}, externalCases: cases })
    const caseIds = model.nodes.filter(node => node.kind === 'external-case').map(node => node.id)
    expect(caseIds).toHaveLength(61)
    expect(caseIds).toContain('case:CVE-69')
    expect(caseIds).toContain('case:CVE-9')
    expect(caseIds).not.toContain('case:CVE-8')
  })

  it('adapts the replay to recorded actors, explicit dependencies, and role handoffs', () => {
    const events: AdminBattleEvent[] = [
      { sequence: 5, type: 'topic.alpha.result', status: 'completed', data: { round: 1, actorRole: 'defender' } },
      { sequence: 2, type: 'topic.alpha.payload_ready', status: 'completed', data: { round: 1, actorRole: 'attacker' } },
      { sequence: 1, type: 'battle.started', status: 'running' },
      { sequence: 3, type: 'topic.alpha.policy_scan', status: 'running', data: { round: 1, actorRole: 'defender' } },
      { sequence: 4, type: 'topic.alpha.report', status: 'completed', data: { round: 1, actorRole: 'defender', parentSequence: 3 } },
    ]
    const model = buildBattleTimelineSceneModel(battle('timeline-battle', 'running', '2026-10-19'), events)

    expect(model.nodes.filter(node => node.kind === 'attacker' || node.kind === 'defender').map(node => node.label)).toEqual(['攻击方', '防守方'])
    expect(model.nodes.find(node => node.id === 'role:attacker')?.position).toEqual([-4.9, 0.15, 0])
    expect(model.nodes.find(node => node.id === 'role:defender')?.position).toEqual([4.9, 0.15, 0])
    expect(model.nodes.filter(node => node.kind === 'timeline-event').map(node => (node.source as AdminBattleEvent).sequence)).toEqual([1, 2, 3, 4, 5])
    expect(model.nodes.filter(node => node.kind === 'timeline-event').map(node => [node.position[0], Number(node.position[2].toFixed(2))])).toEqual([
      [0, 0.6], [-1.45, 1.9], [1.45, 3.2], [1.45, 4.5], [1.45, 5.8],
    ])
    expect(model.nodes.find(node => (node.source as AdminBattleEvent | null)?.sequence === 2)?.actorRole).toBe('attacker')
    expect(model.nodes.find(node => (node.source as AdminBattleEvent | null)?.sequence === 5)?.actorRole).toBe('defender')
    expect(model.nodes.find(node => (node.source as AdminBattleEvent | null)?.sequence === 1)?.actorRole).toBe('system')
    expect(model.edges.filter(edge => edge.kind === 'interaction' && edge.from.startsWith('event:') && edge.to.startsWith('event:')).map(edge => [edge.from, edge.to])).toEqual([
      ['event:timeline-battle:2:1', 'event:timeline-battle:3:3'],
      ['event:timeline-battle:3:3', 'event:timeline-battle:4:4'],
    ])
    expect(model.edges.filter(edge => edge.kind === 'interaction' && !edge.id.startsWith('side-flow:')).every(edge => edge.from.startsWith('event:') && edge.to.startsWith('event:'))).toBe(true)
    expect(model.edges.filter(edge => edge.id.startsWith('side-flow:'))).toHaveLength(1)
    expect(model.edges.filter(edge => edge.kind === 'timeline').map(edge => [edge.from, edge.to])).toEqual([
      ['event:timeline-battle:1:2', 'event:timeline-battle:2:1'],
      ['event:timeline-battle:2:1', 'event:timeline-battle:3:3'],
      ['event:timeline-battle:3:3', 'event:timeline-battle:4:4'],
      ['event:timeline-battle:4:4', 'event:timeline-battle:5:0'],
    ])
    expect(model.nodes.filter(node => node.kind === 'timeline-event').every(node => node.source && typeof node.source === 'object' && 'sequence' in node.source)).toBe(true)
    expect(model.nodes.some(node => node.kind === 'external-case')).toBe(false)
  })

  it('keeps attack jump and defender network nodes at their original positions', () => {
    const model = buildBattleTimelineSceneModel(battle('recorded-only', 'completed', '2026-10-19'), [
      { sequence: 1, type: 'attack.probe.started', data: { agentRole: 'attacker', targetRole: 'defender' } },
    ])

    expect(model.nodes.map(node => node.id)).toEqual([
      'role:attacker', 'role:defender', 'network:jump:1', 'network:jump:2',
      'network:asset:1', 'network:asset:2', 'network:asset:3', 'event:recorded-only:1:0',
    ])
    expect(model.nodes.filter(node => node.kind === 'attack-jump' || node.kind === 'defender-asset').map(node => [node.kind, node.label, node.position])).toEqual([
      ['attack-jump', '攻击跳板', [-2.8, 0.15, -1.4]],
      ['attack-jump', '攻击跳板', [-2.8, 0.15, 1.4]],
      ['defender-asset', '防守内网', [2.8, 0.15, -1.6]],
      ['defender-asset', '防守内网', [2.8, 0.15, 0]],
      ['defender-asset', '防守内网', [2.8, 0.15, 1.6]],
    ])
    expect(model.edges.filter(edge => edge.kind === 'network').map(edge => [edge.from, edge.to])).toEqual([
      ['role:attacker', 'network:jump:1'], ['role:attacker', 'network:jump:2'],
      ['network:jump:1', 'network:asset:1'], ['network:jump:1', 'network:asset:2'],
      ['network:jump:2', 'network:asset:2'], ['network:jump:2', 'network:asset:3'],
      ['network:asset:1', 'role:defender'], ['network:asset:2', 'role:defender'], ['network:asset:3', 'role:defender'],
      ['network:jump:1', 'network:jump:2'], ['network:asset:1', 'network:asset:2'], ['network:asset:2', 'network:asset:3'],
    ])
    expect(model.edges.filter(edge => edge.kind === 'network' && edge.id.startsWith('team-path:')).map(edge => [edge.from, edge.to])).toEqual([
      ['network:jump:1', 'network:jump:2'], ['network:asset:1', 'network:asset:2'], ['network:asset:2', 'network:asset:3'],
    ])
    expect(model.edges.every(edge => model.nodes.some(node => node.id === edge.from) && model.nodes.some(node => node.id === edge.to))).toBe(true)
  })

  it('keeps events without role evidence unclassified instead of assigning them to either side', () => {
    const event: AdminBattleEvent = { sequence: 1, type: 'custom.event', data: { detail: 'unknown source' } }
    const model = buildBattleTimelineSceneModel(battle('unknown-role', 'completed', '2026-10-19'), [event])

    expect(model.nodes.find(node => node.kind === 'timeline-event')?.actorRole).toBe('unknown')
  })
})

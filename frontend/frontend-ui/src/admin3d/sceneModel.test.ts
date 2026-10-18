import { describe, expect, it } from 'vitest'
import type { AdminBattle, AdminBattleEvent, AdminMetrics } from '../adminApi'
import type { ExternalCase } from '../api'
import { buildAdminSceneModel, buildBattleTimelineSceneModel } from './sceneModel'

const battle = (id: string, status: string, createdAt: string): AdminBattle => ({
  id, status, createdAt, topic: id, difficulty: 'mid', attackerOut: { samples: [] }, defenderOut: [],
})

describe('buildAdminSceneModel', () => {
  it('creates fixed role and scheduler nodes, status-colored battle nodes, and standalone case nodes', () => {
    const cases: ExternalCase[] = [{ externalId: 'CVE-1', vendorProject: 'v', product: 'p', title: 'case', dateAdded: '2026-01-01', description: '', requiredAction: '', cwes: [], sourceUrl: 'https://example.test', provenanceStatus: 'verified', synthetic: false, recordKind: 'catalog', source: { publisher: 'p', sourceType: 'feed', catalogVersion: '1', retrievedAt: '2026-01-01', contentSha256: 'abcdef' } }]
    const model = buildAdminSceneModel({ battles: [battle('b1', 'running', '2026-01-01')], metrics: {} as AdminMetrics, externalCases: cases })
    expect(model.nodes.map(node => node.kind)).toEqual(expect.arrayContaining(['attacker', 'defender', 'scheduler', 'battle', 'external-case']))
    expect(model.nodes.find(node => node.id === 'battle:b1')?.color).toBe(model.statusColors.running)
    expect(model.edges.some(edge => edge.from === 'case:CVE-1' || edge.to === 'case:CVE-1')).toBe(false)
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

  it('builds a sequence-ordered event-only 3D path for one battle', () => {
    const events: AdminBattleEvent[] = [
      { sequence: 4, type: 'end', status: 'completed' },
      { sequence: 2, type: 'middle' },
      { sequence: 1, type: 'start' },
    ]
    const model = buildBattleTimelineSceneModel(battle('timeline-battle', 'running', '2026-10-19'), events)

    expect(model.nodes.map(node => node.kind)).toEqual(['timeline-event', 'timeline-event', 'timeline-event'])
    expect(model.nodes.map(node => (node.source as AdminBattleEvent).sequence)).toEqual([1, 2, 4])
    expect(model.edges.map(edge => [edge.from, edge.to])).toEqual([
      ['event:timeline-battle:1:0', 'event:timeline-battle:2:1'],
      ['event:timeline-battle:2:1', 'event:timeline-battle:4:2'],
    ])
    expect(model.nodes.every(node => node.source && typeof node.source === 'object' && 'sequence' in node.source)).toBe(true)
    expect(model.nodes.some(node => node.kind === 'external-case')).toBe(false)
  })
})

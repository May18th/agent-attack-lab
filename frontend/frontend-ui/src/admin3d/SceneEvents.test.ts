import { describe, expect, it } from 'vitest'
import { CatmullRomCurve3, Group, Scene, Vector3 } from 'three'
import { EventCuePlayer, eventTargetRole, eventStatusBadges } from './SceneEvents'
import type { AdminSceneModel, AdminSceneNode } from './sceneModel'

const eventNode = (type: string, data: Record<string, unknown> = {}, actorRole: AdminSceneNode['actorRole'] = 'attacker'): AdminSceneNode => ({
  id: 'event:1', kind: 'timeline-event', label: type, status: 'running', color: '#fff', position: [0, 0, 0], actorRole, source: { type, data },
})

describe('SceneEvents', () => {
  it('honors an explicit event target and otherwise maps attack direction', () => {
    expect(eventTargetRole(eventNode('attack.started', { targetRole: 'attacker' }), 'attack')).toBe('attacker')
    expect(eventTargetRole(eventNode('attack.started'), 'attack')).toBe('defender')
    expect(eventTargetRole(eventNode('round.completed', {}, 'defender'), 'defense')).toBe('attacker')
  })

  it('maps same-side activity to existing role and teammate badges', () => {
    const active = eventNode('battle.created')
    const model = { nodes: [active], edges: [] } as unknown as AdminSceneModel
    const statuses = eventStatusBadges(model, active.id)

    expect(statuses.get('role:attacker')).toEqual({ state: 'probing', text: '攻击方队内事件处理中' })
    expect(statuses.get('network:jump:1')).toEqual({ state: 'probing', text: '攻击方队内协作中' })
    expect(statuses.get('role:defender')).toEqual({ state: 'normal', text: '正常守护' })
  })

  it('marks only the explicit verified target asset as compromised', () => {
    const active = eventNode('attack.compromised', { targetVerified: true, targetAssetId: 'network:asset:2' })
    const model = { nodes: [active], edges: [] } as unknown as AdminSceneModel
    const statuses = eventStatusBadges(model, active.id)

    expect(statuses.get('network:asset:2')).toEqual({ state: 'compromised', text: '已沦陷' })
    expect(statuses.get('network:asset:3')).toEqual({ state: 'normal', text: '正常守护' })
  })

  it('owns the current event cue lifecycle independently from the scene orchestrator', () => {
    const scene = new Scene()
    const player = new EventCuePlayer(() => {})
    const node = eventNode('attack.started')
    const actor = new Group(); actor.position.set(-2, 0, 0)
    const target = new Group(); target.position.set(2, 0, 0)
    const route = new CatmullRomCurve3([new Vector3(-2, 0, 0), new Vector3(2, 0, 0)])

    player.show(scene, node, actor, target, route, true)

    expect(player.label?.element).toHaveTextContent('发起攻击')
    expect(player.label?.element.dataset.paused).toBe('true')
    expect(player.label?.position.x).toBeCloseTo(0)
    player.clear(scene)
    expect(player.label).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'
import { CatmullRomCurve3, Group, Vector3 } from 'three'
import { attackRouteFiberIds, createSecurityRoute, routeProgressAtPoint, routeProgressBoundaries, selectEventFiberRoute } from './NetworkLayout'
import type { AdminSceneModel, AdminSceneNode } from './sceneModel'

const eventNode = (id: string, type: string, data: Record<string, unknown> = {}, actorRole: AdminSceneNode['actorRole'] = 'attacker'): AdminSceneNode => ({
  id, kind: 'timeline-event', label: type, status: 'running', color: '#fff', position: [0, 0, 0], actorRole, source: { type, data },
})

describe('NetworkLayout', () => {
  it('selects existing team and defense routes without owning scene state', () => {
    const first = eventNode('event:1', 'battle.created')
    const request = eventNode('event:2', 'round.started', { round: 1 })
    const response = eventNode('event:3', 'round.completed', { round: 2 }, 'defender')
    const model = { nodes: [first, request, response], edges: [] } as unknown as AdminSceneModel

    expect(selectEventFiberRoute(first, model)).toEqual({ routeId: 'team-path:1', reversed: false })
    expect(selectEventFiberRoute(request, model)).toEqual({ routeId: 'network-path:3', reversed: false })
    expect(selectEventFiberRoute(response, model)).toEqual({ routeId: 'network-path:6', reversed: true })
  })

  it('builds the security route through roles, jumps, barriers and target asset in order', () => {
    const hardware = new Map<string, Group>()
    ;[
      ['role:attacker', -5], ['network:jump:1', -4], ['network:jump:2', -3],
      ['network:asset:2', 2], ['role:defender', 5],
    ].forEach(([id, x]) => { const group = new Group(); group.position.set(Number(x), 0, 0); hardware.set(String(id), group) })
    const barriers = new Map<number, Group>()
    ;[-2, -1, 0, 1].forEach((x, index) => { const group = new Group(); group.position.set(x, 0, 0); barriers.set(index, group) })

    const route = createSecurityRoute(hardware, barriers, 'network:asset:2')!
    expect(route.points.map((point) => point.x)).toEqual([-5, -4, -3, -2, -1, 0, 1, 2, 5])
    expect(route.points[0]).toEqual(new Vector3(-5, 0.68, 0))
  })

  it('maps the selected asset to an ordered, continuous attack fiber path', () => {
    expect(attackRouteFiberIds('network:asset:1')).toEqual([
      'network-path:1', 'team-path:1', 'network-path:2', 'network-path:3', 'network-path:4',
      'network-path:5', 'network-path:6', 'network-path:9',
    ])
    expect(attackRouteFiberIds('network:asset:3').at(-2)).toBe('network-path:8')
    expect(attackRouteFiberIds('network:asset:3').at(-1)).toBe('network-path:11')
  })

  it('locates the route progress at each barrier rather than using a fixed timing', () => {
    const route = new CatmullRomCurve3([
      new Vector3(-5, 0, 0), new Vector3(-4, 0, 0), new Vector3(-3, 0, 0),
      new Vector3(-2, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 0, 0),
      new Vector3(1, 0, 0), new Vector3(2, 0, 0), new Vector3(5, 0, 0),
    ], false, 'centripetal', 0.18)

    const firstBarrierProgress = routeProgressAtPoint(route, new Vector3(-2, 0, 0))!
    const secondBarrierProgress = routeProgressAtPoint(route, new Vector3(1, 0, 0))!
    expect(firstBarrierProgress).toBeGreaterThan(0.2)
    expect(firstBarrierProgress).toBeLessThan(0.4)
    expect(secondBarrierProgress).toBeGreaterThan(firstBarrierProgress)
    expect(secondBarrierProgress).toBeLessThan(0.7)
    expect(route.getPointAt(firstBarrierProgress).distanceTo(new Vector3(-2, 0, 0))).toBeLessThan(0.08)
    expect(route.getPointAt(secondBarrierProgress).distanceTo(new Vector3(1, 0, 0))).toBeLessThan(0.08)
    expect(routeProgressAtPoint(undefined, new Vector3())).toBeUndefined()
  })

  it('derives attack path boundaries from the actual route lengths', () => {
    const route = new CatmullRomCurve3([
      new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(11, 0, 0),
    ], false, 'centripetal', 0.18)

    const boundaries = routeProgressBoundaries(route, [new Vector3(1, 0, 0), new Vector3(11, 0, 0)])

    expect(boundaries[0]).toBeGreaterThan(0.05)
    expect(boundaries[0]).toBeLessThan(0.2)
    expect(boundaries[1]).toBe(1)
  })
})

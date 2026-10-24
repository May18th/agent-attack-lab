import { describe, expect, it } from 'vitest'
import { CatmullRomCurve3, Mesh, MeshPhysicalMaterial, Vector3 } from 'three'
import { PacketPlayer } from './PacketPlayer'
import type { AdminSceneModel, AdminSceneNode } from './sceneModel'

const model = { sampleCount: 3 } as AdminSceneModel
const eventNode = (type: string, data: Record<string, unknown> = {}): AdminSceneNode => ({
  id: 'event:1', kind: 'timeline-event', label: type, status: 'running', color: '#ffffff', position: [0, 0, 0],
  actorRole: 'attacker', source: { type, data },
})

describe('PacketPlayer', () => {
  it('creates six packet units and exposes only the recorded sample count', () => {
    const player = new PacketPlayer()
    player.setCount(eventNode('attack.completed', { sampleCount: 3 }), model)

    expect(player.marker.name).toBe('replay-packet')
    expect(player.units).toHaveLength(6)
    expect(player.units.map((unit) => unit.visible)).toEqual([true, true, true, false, false, false])
  })

  it('uses packet shells large enough to read clearly in the topology view', () => {
    const player = new PacketPlayer()
    const shell = player.units[0].getObjectByName('replay-packet-shell') as Mesh

    expect((shell.geometry as import('three').CylinderGeometry).parameters.radiusTop).toBeGreaterThanOrEqual(0.13)
  })

  it('preserves the existing five-packet burst for probe events', () => {
    const player = new PacketPlayer()
    player.setCount(eventNode('attack.probe.started'), model)

    expect(player.units.filter((unit) => unit.visible)).toHaveLength(5)
  })

  it('colors unverified penetration orange and positions visible units on the route', () => {
    const player = new PacketPlayer()
    player.setCount(eventNode('attack.started'), model)
    player.setVisualState('penetrated')
    const route = new CatmullRomCurve3([new Vector3(0, 0, 0), new Vector3(4, 0, 0)])
    player.position(route, 0.5, new Vector3(4, 0, 0), false)

    const shell = player.units[0].getObjectByName('replay-packet-shell') as Mesh
    expect((shell.material as MeshPhysicalMaterial).emissive.getHexString()).toBe('f39c12')
    expect(player.units[0].position.x).toBeCloseTo(2)
    expect(player.units[1].position.x).toBeLessThan(player.units[0].position.x)
  })

  it('colors intercepted packets green', () => {
    const player = new PacketPlayer()
    player.setVisualState('intercepted')
    const shell = player.units[0].getObjectByName('replay-packet-shell') as Mesh

    expect((shell.material as MeshPhysicalMaterial).emissive.getHexString()).toBe('36c98e')
  })

  it('only turns a compromise cue red when target verification evidence is present', () => {
    const player = new PacketPlayer()
    player.setTheme(eventNode('attack.compromised'))
    expect(player.visualState).toBe('attack')
    player.setTheme({ ...eventNode('attack.compromised'), source: { type: 'attack.compromised', data: { targetVerified: true } } })
    expect(player.visualState).toBe('compromised')
    const shell = player.units[0].getObjectByName('replay-packet-shell') as Mesh
    expect((shell.material as MeshPhysicalMaterial).emissive.getHexString()).toBe('ff435f')
  })
})

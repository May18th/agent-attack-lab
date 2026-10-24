import { describe, expect, it } from 'vitest'
import { Group, Mesh, MeshPhysicalMaterial } from 'three'
import { createTopologyNode, isExplicitlyCompromised, setFiberProgressState } from './sceneHardware'
import type { AdminSceneNode } from './sceneModel'

const node = (kind: AdminSceneNode['kind'], id: string = kind): AdminSceneNode => ({
  id, kind, label: id, status: 'unknown', color: '#4a9eff', position: [0, 0, 0], source: null,
})

describe('sceneHardware', () => {
  it('gives attack, relay, fortress, and server nodes distinct silhouettes', () => {
    const attacker = createTopologyNode(node('attacker', 'role:attacker'))
    const jump = createTopologyNode(node('attack-jump', 'network:jump:1'))
    const defender = createTopologyNode(node('defender', 'role:defender'))
    const asset = createTopologyNode(node('defender-asset', 'network:asset:1'))

    expect(attacker.getObjectByName('attack-weapon')).toBeInstanceOf(Mesh)
    expect(jump.getObjectByName('relay-antenna')).toBeInstanceOf(Mesh)
    expect(defender.getObjectByName('fortress-tower:0')).toBeInstanceOf(Mesh)
    expect(asset.getObjectByName('server-rack:2')).toBeInstanceOf(Mesh)
  })

  it('distinguishes completed, current, and pending route segments', () => {
    const fiber = new Group()
    const jacket = new MeshPhysicalMaterial()
    const inner = new MeshPhysicalMaterial()
    const arrow = new MeshPhysicalMaterial()
    fiber.userData.materials = { jacket, inner, arrow }

    setFiberProgressState(fiber, 'completed')
    expect(fiber.userData.pathProgress).toBe('completed')
    expect(jacket.opacity).toBeLessThan(0.3)
    setFiberProgressState(fiber, 'current')
    expect(fiber.userData.pathProgress).toBe('current')
    expect(inner.color.getHexString()).toBe('ff5058')
    setFiberProgressState(fiber, 'pending')
    expect(fiber.userData.pathProgress).toBe('pending')
    expect(inner.color.getHexString()).toBe('71808b')
  })

  it('does not treat a compromise-shaped event without verification evidence as a compromised node', () => {
    const unverified = { ...node('timeline-event'), source: { type: 'attack.compromised', data: { targetVerified: false } } }
    const verified = { ...node('timeline-event'), source: { type: 'attack.compromised', data: { targetVerified: true } } }
    expect(isExplicitlyCompromised(unverified)).toBe(false)
    expect(isExplicitlyCompromised(verified)).toBe(true)
  })
})

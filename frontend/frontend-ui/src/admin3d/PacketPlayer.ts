import { CatmullRomCurve3, CylinderGeometry, Group, Mesh, MeshPhysicalMaterial, SphereGeometry, Vector3 } from 'three'
import { replayEventCue, type AdminSceneModel, type AdminSceneNode } from './sceneModel'

export type PacketVisualState = 'attack' | 'intercepted' | 'penetrated' | 'compromised'

export class PacketPlayer {
  readonly marker = new Group()
  readonly units: Group[] = []
  visualState: PacketVisualState = 'attack'

  constructor() {
    this.marker.name = 'replay-packet'
    for (let unitIndex = 0; unitIndex < 6; unitIndex += 1) {
      const unit = new Group()
      unit.name = `replay-packet-unit-${unitIndex}`
      const scale = 1 - unitIndex * 0.055
      const shell = new Mesh(new CylinderGeometry(0.14 * scale, 0.14 * scale, 0.2 * scale, 6), new MeshPhysicalMaterial({ color: '#8feaff', emissive: '#22caff', emissiveIntensity: 1.7, transparent: true, opacity: 0.72, metalness: 0.16, roughness: 0.18, clearcoat: 1 }))
      shell.name = unitIndex === 0 ? 'replay-packet-shell' : `replay-packet-shell-${unitIndex}`
      unit.add(shell)
      const core = new Mesh(new SphereGeometry(0.062 * scale, 10, 8), new MeshPhysicalMaterial({ color: '#ffffff', emissive: '#8feeff', emissiveIntensity: 2.6, roughness: 0.12 }))
      core.name = unitIndex === 0 ? 'replay-packet-core' : `replay-packet-core-${unitIndex}`
      unit.add(core)
      const trailCount = unitIndex === 0 ? 3 : 1
      for (let index = 0; index < trailCount; index += 1) {
        const trail = new Mesh(new CylinderGeometry(0.035 - index * 0.007, 0.035 - index * 0.007, 0.1, 6), new MeshPhysicalMaterial({ color: '#43caff', emissive: '#29bbff', emissiveIntensity: 1.2 - index * 0.25, transparent: true, opacity: 0.48 - index * 0.1, metalness: 0.1, roughness: 0.2, depthWrite: false }))
        trail.name = `replay-packet-trail-${unitIndex}-${index}`
        trail.position.y = -0.13 - index * 0.08
        unit.add(trail)
      }
      this.marker.add(unit)
      this.units.push(unit)
    }
    this.marker.visible = false
  }

  setCount(node: AdminSceneNode, model?: AdminSceneModel): void {
    const source = node.source as { eventType?: string; type?: string; data?: { caught?: unknown[]; sampleCount?: number } } | null
    const cue = source ? replayEventCue(source) : undefined
    const recordedSampleCount = source?.data?.sampleCount ?? model?.sampleCount
    const count = typeof recordedSampleCount === 'number' && (source?.eventType ?? source?.type) === 'attack.completed'
      ? Math.max(1, Math.min(this.units.length, Math.floor(recordedSampleCount)))
      : cue?.kind === 'defense' ? Math.min(6, 3 + (source?.data?.caught?.length ?? 0))
        : cue?.kind === 'defense-request' ? 3
          : cue?.kind === 'compromised' ? 6
            : cue?.kind === 'attack' || cue?.kind === 'exploit' || cue?.kind === 'probe' ? 5 : 2
    this.units.forEach((unit, index) => { unit.visible = index < count })
  }

  setTheme(node: AdminSceneNode): void {
    const source = node.source as { eventType?: string; type?: string; data?: Record<string, unknown> } | null
    const cue = source ? replayEventCue(source) : undefined
    this.setVisualState(cue?.kind === 'compromised' && source?.data?.targetVerified === true ? 'compromised' : 'attack')
  }

  setVisualState(state: PacketVisualState): void {
    this.visualState = state
    const color = state === 'intercepted' ? '#36C98E' : state === 'penetrated' ? '#F39C12' : state === 'compromised' ? '#ff435f' : '#4A9EFF'
    this.units.forEach((unit) => unit.traverse((object) => {
      if (!(object instanceof Mesh)) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach((material) => {
        if (!(material instanceof MeshPhysicalMaterial)) return
        material.color.set(object.name.includes('core') ? '#ffffff' : color)
        material.emissive.set(color)
      })
    }))
  }

  position(path: CatmullRomCurve3 | undefined, progress: number, target: Vector3, reversed = false): void {
    this.units.filter((unit) => unit.visible).forEach((unit, index) => {
      if (!path) { unit.position.copy(target); return }
      const position = reversed
        ? Math.max(0, Math.min(1, 1 - progress + index * 0.11))
        : Math.max(0, Math.min(1, progress - index * 0.11))
      unit.position.copy(path.getPointAt(position))
      const tangent = path.getTangentAt(position).normalize()
      if (reversed) tangent.negate()
      unit.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), tangent)
    })
  }

  dispose(): void {
    this.marker.traverse((object) => {
      if (!(object instanceof Mesh)) return
      object.geometry.dispose()
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach((material) => material.dispose())
    })
  }
}

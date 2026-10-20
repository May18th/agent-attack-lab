import { BoxGeometry, CylinderGeometry, EdgesGeometry, Group, LineBasicMaterial, LineSegments, Mesh, MeshPhysicalMaterial, Scene, SphereGeometry, TorusGeometry, Vector3 } from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import type { AdminSceneModel, SecurityPathTheme } from './sceneModel'

export const SECURITY_BARRIER_LABELS = ['输入标准化清洗', '推理引导', '工具动作管控', '审计监测恢复'] as const
const SECURITY_BARRIER_SHORT_LABELS = ['1清洗', '2推理', '3管控', '4审计'] as const
export const SECURITY_BARRIER_COLORS = ['#00D4AA', '#9B59B6', '#F39C12', '#E74C3C'] as const

export type SecurityBarriers = {
  groups: Map<number, Group>
  labels: Map<number, CSS2DObject>
  stats: Map<number, CSS2DObject>
}

export function createSecurityBarriers(scene: Scene, model: AdminSceneModel): SecurityBarriers {
  const collection: SecurityBarriers = { groups: new Map(), labels: new Map(), stats: new Map() }
  const jump = model.nodes.find((node) => node.id === 'network:jump:2')
  const asset = model.nodes.find((node) => node.id === 'network:asset:2')
  if (!jump || !asset) return collection
  for (let index = 0; index < SECURITY_BARRIER_LABELS.length; index += 1) {
    const progress = (index + 1) / (SECURITY_BARRIER_LABELS.length + 1)
    const x = jump.position[0] + (asset.position[0] - jump.position[0]) * progress
    const barrierNode = model.nodes.find((node) => node.id === `security:barrier:${index + 1}`)
    const group = new Group()
    group.name = `security-barrier:${index + 1}`
    group.position.set(barrierNode?.position[0] ?? x, barrierNode?.position[1] ?? 0.15, barrierNode?.position[2] ?? 0)
    group.userData.sceneNodeId = barrierNode?.id ?? `security:barrier:${index + 1}`
    group.userData.sceneNode = barrierNode
    const color = SECURITY_BARRIER_COLORS[index]
    const material = new MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: 0.48, transparent: true, opacity: 0.58, metalness: 0.18, roughness: 0.22, depthWrite: false })
    const wall = new Mesh(new BoxGeometry(0.34, 1.72, 1.5), material.clone())
    wall.name = 'security-barrier-wall'
    wall.position.y = 0.84
    group.add(wall)
    const wallFrame = new LineSegments(new EdgesGeometry(wall.geometry), new LineBasicMaterial({ color, transparent: true, opacity: 0.82 }))
    wallFrame.name = 'security-barrier-wall-frame'
    wallFrame.position.copy(wall.position)
    group.add(wallFrame)
    if (index === 0) {
      for (let grid = -1; grid <= 1; grid += 1) {
        const vertical = new Mesh(new CylinderGeometry(0.012, 0.012, 1.12, 6), material.clone())
        vertical.position.set(0, 0.7, grid * 0.26)
        group.add(vertical)
        const horizontal = new Mesh(new CylinderGeometry(0.012, 0.012, 1.12, 6), material.clone())
        horizontal.position.set(0, 0.7 + grid * 0.26, 0)
        horizontal.rotation.x = Math.PI / 2
        group.add(horizontal)
      }
    } else if (index === 1) {
      const outer = new Mesh(new TorusGeometry(0.58, 0.035, 8, 40), material)
      outer.rotation.y = Math.PI / 2; outer.position.y = 0.7; group.add(outer)
      const inner = new Mesh(new TorusGeometry(0.38, 0.018, 6, 32), material.clone())
      inner.rotation.y = Math.PI / 2; inner.position.y = 0.7; group.add(inner)
    } else if (index === 2) {
      const lockBody = new Mesh(new CylinderGeometry(0.26, 0.26, 0.34, 8), material)
      lockBody.position.set(0, 0.56, 0); group.add(lockBody)
      const shackle = new Mesh(new TorusGeometry(0.18, 0.035, 6, 20, Math.PI), material.clone())
      shackle.position.set(0, 0.88, 0); shackle.rotation.set(0, Math.PI / 2, Math.PI); group.add(shackle)
    } else {
      const radar = new Mesh(new TorusGeometry(0.52, 0.028, 6, 32), material)
      radar.rotation.y = Math.PI / 2; radar.position.y = 0.7; group.add(radar)
      const eye = new Mesh(new SphereGeometry(0.18, 12, 8), material.clone())
      eye.scale.set(1.45, 0.42, 0.42); eye.position.set(0, 0.7, 0); group.add(eye)
    }
    const pulse = new Mesh(new TorusGeometry(0.72, 0.025, 6, 40), new MeshPhysicalMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 1.8, transparent: true, opacity: 0, depthWrite: false }))
    pulse.rotation.x = Math.PI / 2; pulse.position.y = 0.7; pulse.visible = false; pulse.name = `security-barrier-pulse:${index + 1}`
    group.add(pulse)
    const burst = new Group()
    burst.name = 'security-impact-burst'
    burst.visible = false
    for (let particleIndex = 0; particleIndex < 8; particleIndex += 1) {
      const particle = new Mesh(new SphereGeometry(0.045, 6, 5), new MeshPhysicalMaterial({ color: '#E74C3C', emissive: '#E74C3C', emissiveIntensity: 1.6, transparent: true, opacity: 0, depthWrite: false }))
      particle.name = `security-impact-particle:${particleIndex}`
      particle.userData.angle = (Math.PI * 2 * particleIndex) / 8
      burst.add(particle)
    }
    group.add(burst)
    group.userData.baseColor = color
    // Keep the anchor position so hit feedback can add a short, reversible
    // shake without drifting the barrier out of the authored layout.
    group.userData.basePosition = group.position.clone()
    group.userData.materials = group.children.flatMap((child) => child instanceof Mesh && !child.name.startsWith('security-barrier-pulse:') ? [child.material as MeshPhysicalMaterial] : [])
    group.userData.pulse = pulse
    group.userData.burst = burst
    collection.groups.set(index, group)
    scene.add(group)

    const element = document.createElement('div')
    element.className = 'admin3d-security-barrier-label admin3d-security-barrier-label--compact'
    element.dataset.sceneNodeId = barrierNode?.id ?? `security:barrier:${index + 1}`
    element.style.setProperty('--barrier-color', color)
    element.textContent = SECURITY_BARRIER_SHORT_LABELS[index]
    element.title = `第 ${index + 1} 层：${SECURITY_BARRIER_LABELS[index]}`
    element.setAttribute('aria-label', element.title)
    const label = new CSS2DObject(element)
    label.position.set(group.position.x, group.position.y + 1.96, group.position.z)
    collection.labels.set(index, label)
    scene.add(label)
  }
  return collection
}

export function applySecurityTheme(collection: SecurityBarriers, theme: SecurityPathTheme): void {
  const focused = new Set(theme.focusedLayers)
  collection.groups.forEach((group, index) => {
    const isFocused = focused.has(index + 1)
    const materials = (group.userData.materials as MeshPhysicalMaterial[] | undefined) ?? []
    materials.forEach((material) => { material.opacity = isFocused ? 0.64 : 0.14; material.emissiveIntensity = isFocused ? 0.62 : 0.16 })
    const label = collection.labels.get(index)
    if (label) { label.element.dataset.focused = String(isFocused); label.element.style.opacity = isFocused ? '1' : '0.46' }
  })
}

export function clearBarrierFeedback(scene: Scene | undefined, collection: SecurityBarriers): void {
  collection.stats.forEach((label) => { scene?.remove(label); label.element.remove() })
  collection.stats.clear()
  collection.groups.forEach((group) => {
    const pulse = group.userData.pulse as Mesh | undefined
    if (pulse) { pulse.visible = false; (pulse.material as MeshPhysicalMaterial).opacity = 0; pulse.scale.setScalar(1) }
    const baseColor = String(group.userData.baseColor ?? '#ffffff')
    const basePosition = group.userData.basePosition as Vector3 | undefined
    if (basePosition) group.position.copy(basePosition)
    group.rotation.set(0, 0, 0)
    const materials = (group.userData.materials as MeshPhysicalMaterial[] | undefined) ?? []
    materials.forEach((material) => { material.color.set(baseColor); material.emissive.set(baseColor) })
    const burst = group.userData.burst as Group | undefined
    if (burst) {
      burst.visible = false
      burst.children.forEach((particle) => {
        particle.position.set(0, 0.7, 0)
        if (particle instanceof Mesh) (particle.material as MeshPhysicalMaterial).opacity = 0
      })
    }
  })
}

export function showBarrierStat(scene: Scene | undefined, collection: SecurityBarriers, index: number, outcome: 'intercepted' | 'penetrated', intercepted?: number, total?: number): void {
  if (!scene || collection.stats.has(index)) return
  const barrier = collection.groups.get(index)
  if (!barrier) return
  const element = document.createElement('div')
  element.className = `admin3d-security-barrier-stat outcome-${outcome}`
  element.textContent = outcome === 'intercepted'
    ? intercepted !== undefined && total !== undefined ? `第 ${index + 1} 层拦截 ${intercepted}/${total}` : `第 ${index + 1} 层拦截 未记录`
    : `第 ${index + 1} 层放行`
  const label = new CSS2DObject(element)
  label.position.copy(barrier.position).add(new Vector3(0, 1.24, 0))
  collection.stats.set(index, label)
  scene.add(label)
}

export class BarrierFeedbackPlayer {
  frame = 0
  private readonly render: () => void

  constructor(render: () => void) {
    this.render = render
  }

  cancel(): void {
    cancelAnimationFrame(this.frame)
    this.frame = 0
  }

  pulse(scene: Scene | undefined, collection: SecurityBarriers, theme: SecurityPathTheme, index: number, outcome: 'intercepted' | 'penetrated', intercepted?: number, total?: number): void {
    const group = collection.groups.get(index)
    if (!group) return
    const pulse = group.userData.pulse as Mesh | undefined
    const feedbackColor = outcome === 'intercepted' ? '#E74C3C' : '#4A9EFF'
    const materials = (group.userData.materials as MeshPhysicalMaterial[] | undefined) ?? []
    const burst = group.userData.burst as Group | undefined
    showBarrierStat(scene, collection, index, outcome, intercepted, total)
    if (!pulse) return
    this.cancel()
    pulse.visible = true
    const pulseMaterial = pulse.material as MeshPhysicalMaterial
    pulseMaterial.color.set(feedbackColor)
    pulseMaterial.emissive.set(feedbackColor)
    if (burst) {
      burst.visible = outcome === 'intercepted'
      burst.children.forEach((particle) => {
        if (!(particle instanceof Mesh)) return
        particle.position.set(0, 0.7, 0)
        const material = particle.material as MeshPhysicalMaterial
        material.color.set(feedbackColor)
        material.emissive.set(feedbackColor)
        material.opacity = outcome === 'intercepted' ? 0.9 : 0
      })
    }
    const startedAt = performance.now()
    const basePosition = (group.userData.basePosition as Vector3 | undefined)?.clone() ?? group.position.clone()
    const baseRotation = group.rotation.clone()
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / 780)
      // A restrained, rapidly decaying vibration makes the wall itself react
      // to impact while preserving the scene's fixed layout.  Penetration is
      // intentionally gentler than interception so the two outcomes remain
      // visually distinct without turning into a large camera shake.
      const shakeEnvelope = (1 - progress) * (outcome === 'intercepted' ? 0.06 : 0.025)
      const shakePhase = progress * Math.PI * 14
      group.position.set(
        basePosition.x + Math.sin(shakePhase) * shakeEnvelope,
        basePosition.y + Math.cos(shakePhase * 0.72) * shakeEnvelope * 0.35,
        basePosition.z + Math.cos(shakePhase * 0.9) * shakeEnvelope * 0.8,
      )
      group.rotation.set(
        baseRotation.x + Math.cos(shakePhase * 0.8) * shakeEnvelope * 0.34,
        baseRotation.y + Math.sin(shakePhase * 0.65) * shakeEnvelope * 0.18,
        baseRotation.z + Math.sin(shakePhase) * shakeEnvelope * 0.5,
      )
      pulse.scale.setScalar(0.72 + progress * 1.25)
      pulseMaterial.opacity = (1 - progress) * 0.84
      materials.forEach((material) => { material.emissiveIntensity = 0.4 + (1 - progress) * 1.5 })
      if (burst) {
        burst.children.forEach((particle) => {
          if (!(particle instanceof Mesh)) return
          const angle = Number(particle.userData.angle ?? 0)
          particle.position.set(Math.cos(angle) * progress * 0.55, 0.7 + Math.sin(angle * 2) * progress * 0.18, Math.sin(angle) * progress * 0.55)
          ;(particle.material as MeshPhysicalMaterial).opacity = (1 - progress) * 0.9
        })
      }
      this.render()
      if (progress < 1) this.frame = requestAnimationFrame(animate)
      else {
        group.position.copy(basePosition)
        group.rotation.copy(baseRotation)
        pulse.visible = false
        pulseMaterial.opacity = 0
        if (burst) burst.visible = false
        applySecurityTheme(collection, theme)
        this.frame = 0
      }
    }
    this.frame = requestAnimationFrame(animate)
  }

  flashDefense(collection: SecurityBarriers, theme: SecurityPathTheme): void {
    const groups = [...collection.groups.values()]
    if (!groups.length) return
    this.cancel()
    const startedAt = performance.now()
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / 720)
      groups.forEach((group) => {
        const pulse = group.userData.pulse as Mesh | undefined
        if (!pulse) return
        pulse.visible = true
        pulse.scale.setScalar(0.72 + progress * 1.1)
        ;(pulse.material as MeshPhysicalMaterial).color.set('#36C98E')
        ;(pulse.material as MeshPhysicalMaterial).emissive.set('#36C98E')
        ;(pulse.material as MeshPhysicalMaterial).opacity = (1 - progress) * 0.72
      })
      this.render()
      if (progress < 1) this.frame = requestAnimationFrame(animate)
      else {
        groups.forEach((group) => {
          const pulse = group.userData.pulse as Mesh | undefined
          if (pulse) { pulse.visible = false; (pulse.material as MeshPhysicalMaterial).opacity = 0 }
        })
        applySecurityTheme(collection, theme)
        this.frame = 0
      }
    }
    this.frame = requestAnimationFrame(animate)
  }
}

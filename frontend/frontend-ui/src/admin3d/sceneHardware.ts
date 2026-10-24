import {
  BoxGeometry, BufferGeometry, CatmullRomCurve3, Color, ConeGeometry, CylinderGeometry, EdgesGeometry, ExtrudeGeometry,
  Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Mesh, MeshPhysicalMaterial,
  MeshStandardMaterial, Object3D, OctahedronGeometry, Shape, SphereGeometry, TorusGeometry, TubeGeometry, Vector3,
} from 'three'
import type { AdminSceneEdge, AdminSceneNode } from './sceneModel'

const palette = {
  attacker: '#63b4ff',
  defender: '#57e8c7',
  scheduler: '#78eaff',
  unknown: '#92a9c4',
  fiber: '#2c9eb9',
  active: '#ff9b56',
  compromised: '#ff435f',
}

function addMesh(parent: Group, name: string, geometry: BufferGeometry, material: MeshStandardMaterial | MeshPhysicalMaterial, position: [number, number, number]): Mesh {
  const mesh = new Mesh(geometry, material)
  mesh.name = name
  mesh.position.set(...position)
  parent.add(mesh)
  return mesh
}

function primaryColor(node: AdminSceneNode): string {
  if (node.kind === 'attacker' || node.kind === 'attack-jump') return palette.attacker
  if (node.kind === 'defender' || node.kind === 'defender-asset') return palette.defender
  if (node.kind === 'scheduler') return palette.scheduler
  return node.color || palette.unknown
}

function shieldGeometry(): ExtrudeGeometry {
  const shape = new Shape()
  shape.moveTo(0, 0.48)
  shape.lineTo(0.38, 0.28)
  shape.lineTo(0.33, -0.12)
  shape.lineTo(0, -0.47)
  shape.lineTo(-0.33, -0.12)
  shape.lineTo(-0.38, 0.28)
  shape.closePath()
  return new ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.035, bevelThickness: 0.035 })
}

function addCircuitTrace(parent: Group, node: AdminSceneNode, color: string): void {
  const material = new LineBasicMaterial({ color, transparent: true, opacity: 0.36 })
  const points = new Float32Array([
    -0.28, 0.86, 0.04, -0.13, 0.86, 0.04,
    -0.13, 0.86, 0.04, -0.04, 0.96, 0.04,
    -0.04, 0.96, 0.04, 0.18, 0.96, 0.04,
    0.18, 0.96, 0.04, 0.28, 0.86, 0.04,
    0.03, 0.84, 0.06, 0.03, 0.76, 0.06,
    0.03, 0.76, 0.06, 0.23, 0.76, 0.06,
  ])
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3))
  const trace = new LineSegments(geometry, material)
  trace.name = `circuit-trace:${node.id}`
  parent.add(trace)
}

export function createTopologyNode(node: AdminSceneNode): Group {
  const group = new Group()
  group.name = `node:${node.id}`
  group.userData.sceneNodeId = node.id
  group.userData.sceneNode = node
  const depthOffset = node.kind === 'attacker' ? -0.22 : node.kind === 'defender' ? 0.24 : node.kind === 'scheduler' ? -0.12 : 0
  group.position.set(node.position[0], node.position[1], node.position[2] + depthOffset)
  const color = primaryColor(node)
  const metal = new MeshStandardMaterial({ color: '#354956', metalness: 0.72, roughness: 0.31 })
  const outerColor = node.kind === 'attacker' || node.kind === 'attack-jump' ? '#183c63' : node.kind === 'defender' || node.kind === 'defender-asset' ? '#1b625a' : '#244957'
  const outer = new MeshPhysicalMaterial({ color: outerColor, metalness: 0.46, roughness: 0.26, clearcoat: 0.85, clearcoatRoughness: 0.24, wireframe: true, transparent: true, opacity: 0.74 })
  const coreMaterial = new MeshPhysicalMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.72,
    metalness: 0.06,
    roughness: 0.16,
    transparent: true,
    opacity: 0.72,
    clearcoat: 1,
  })

  let shell: Mesh
  if (node.kind === 'defender') {
    shell = addMesh(group, `carrier:${node.id}`, shieldGeometry(), outer, [0, 0.69, -0.08])
    for (let index = 0; index < 3; index += 1) {
      addMesh(group, `fortress-tower:${index}`, new BoxGeometry(0.2, 0.5 + (index === 1 ? 0.18 : 0), 0.36), outer.clone(), [(index - 1) * 0.39, 0.3, -0.05])
    }
  } else if (node.kind === 'defender-asset') {
    shell = addMesh(group, `carrier:${node.id}`, new BoxGeometry(0.3, 0.72, 0.38), outer, [0, 0.47, 0])
    for (let index = 0; index < 3; index += 1) {
      const rack = addMesh(group, `server-rack:${index}`, new BoxGeometry(0.22, 0.66, 0.36), outer.clone(), [(index - 1) * 0.28, 0.42, 0.12])
      rack.userData.clusterIndex = index
    }
  } else if (node.kind === 'scheduler') {
    shell = addMesh(group, `carrier:${node.id}`, new CylinderGeometry(0.38, 0.42, 0.5, 6, 1), outer, [0, 0.66, 0])
  } else if (node.kind === 'attacker') {
    shell = addMesh(group, `carrier:${node.id}`, new OctahedronGeometry(0.56, 0), outer, [0, 0.68, 0])
    shell.rotation.set(0.18, Math.PI / 4, 0.12)
    const weapon = addMesh(group, 'attack-weapon', new ConeGeometry(0.15, 0.56, 6), coreMaterial, [0.56, 0.72, 0])
    weapon.rotation.z = -Math.PI / 2
  } else if (node.kind === 'attack-jump') {
    shell = addMesh(group, `carrier:${node.id}`, new CylinderGeometry(0.34, 0.4, 0.55, 8), outer, [0, 0.62, 0])
    addMesh(group, 'relay-antenna', new CylinderGeometry(0.025, 0.025, 0.42, 6), coreMaterial, [0, 1.1, 0])
    addMesh(group, 'relay-signal', new SphereGeometry(0.085, 8, 6), coreMaterial, [0, 1.34, 0])
  } else if (node.kind === 'timeline-event') {
    shell = addMesh(group, `event-signal:${node.id}`, new CylinderGeometry(0.14, 0.14, 0.12, 6), outer, [0, 0.18, 0])
  } else {
    shell = addMesh(group, `carrier:${node.id}`, new CylinderGeometry(0.27, 0.3, 0.38, 6), outer, [0, 0.56, 0])
  }
  const edges = new LineSegments(new EdgesGeometry(shell.geometry), new LineBasicMaterial({ color, transparent: true, opacity: 0.66 }))
  edges.name = `carrier-edges:${node.id}`
  edges.position.copy(shell.position)
  edges.rotation.copy(shell.rotation)
  group.add(edges)

  const coreY = node.kind === 'timeline-event' ? 0.18 : 0.68
  const core = addMesh(group, `energy-core:${node.id}`, new OctahedronGeometry(node.kind === 'timeline-event' ? 0.085 : 0.25, 1), coreMaterial, [0, coreY, 0.03])
  core.userData.baseColor = color
  addMesh(group, `core-ring:${node.id}`, new TorusGeometry(0.32, 0.012, 6, 40), new MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: 0.5, transparent: true, opacity: 0.62, metalness: 0.2, roughness: 0.32 }), [0, coreY, 0])
    .rotation.x = Math.PI / 2

  const auraMaterial = new MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: 0.75, transparent: true, opacity: 0.16, metalness: 0.1, roughness: 0.2 })
  const aura = addMesh(group, `state-aura:${node.id}`, new TorusGeometry(node.kind === 'timeline-event' ? 0.2 : 0.62, 0.035, 6, 48), auraMaterial, [0, 0.05, 0])
  aura.rotation.x = Math.PI / 2
  if (node.kind === 'attacker' || node.kind === 'defender' || node.kind === 'attack-jump' || node.kind === 'defender-asset') {
    const factionRing = new Group()
    factionRing.name = `faction-ring:${node.id}`
    factionRing.userData.style = node.kind === 'attacker' || node.kind === 'attack-jump' ? 'dashed' : 'solid'
    factionRing.position.y = 0.05
    factionRing.rotation.x = Math.PI / 2
    const ringMaterial = new MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: 0.48, transparent: true, opacity: 0.58, metalness: 0.18, roughness: 0.3 })
    if (factionRing.userData.style === 'dashed') {
      const segments = 16
      const segmentAngle = (Math.PI * 2) / segments
      for (let index = 0; index < segments; index += 1) {
        const dash = new Mesh(new TorusGeometry(0.74, 0.012, 4, 8, segmentAngle * 0.68), ringMaterial)
        dash.name = `faction-ring-dash:${node.id}:${index}`
        dash.rotation.z = index * segmentAngle
        factionRing.add(dash)
      }
    } else {
      const ring = new Mesh(new TorusGeometry(0.74, 0.012, 4, 64), ringMaterial)
      ring.name = `faction-ring-line:${node.id}`
      factionRing.add(ring)
    }
    group.add(factionRing)
  }
  const scanWaves = new Group()
  scanWaves.name = `scan-waves:${node.id}`
  for (let index = 0; index < 3; index += 1) {
    const scan = addMesh(scanWaves, `scan-wave:${node.id}:${index}`, new TorusGeometry(0.5, 0.012, 6, 48), new MeshPhysicalMaterial({ color: '#00d9ff', emissive: '#00d9ff', emissiveIntensity: 1.6, transparent: true, opacity: 0.68, roughness: 0.18 }), [0, 0, 0])
    scan.rotation.x = Math.PI / 2
    scan.userData.phase = index / 3
    scan.visible = false
  }
  scanWaves.position.y = 0.74
  group.add(scanWaves)
  const selection = addMesh(group, `selection-ring:${node.id}`, new TorusGeometry(0.76, 0.015, 6, 56), new MeshPhysicalMaterial({ color: '#56caff', emissive: '#3e9eff', emissiveIntensity: 1.25, transparent: true, opacity: 0.82, roughness: 0.18 }), [0, 0.045, 0])
  selection.rotation.x = Math.PI / 2
  selection.visible = false
  const groundRing = addMesh(group, `ground-ring:${node.id}`, new TorusGeometry(0.55, 0.009, 4, 40), new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, transparent: true, opacity: 0.24, roughness: 0.8 }), [0, -0.62, 0])
  groundRing.rotation.x = Math.PI / 2
  addCircuitTrace(group, node, color)
  group.userData.core = core
  group.userData.aura = aura
  group.userData.scanWaves = scanWaves
  group.userData.selection = selection
  group.userData.baseColor = color
  group.userData.visualState = 'normal'
  group.userData.nodeMaterials = { metal, outer, core: coreMaterial }
  return group
}

export function setFiberProgressState(group: Group, state: 'completed' | 'current' | 'pending'): void {
  group.userData.pathProgress = state
  const { jacket, inner, arrow } = group.userData.materials as { jacket: MeshPhysicalMaterial; inner: MeshPhysicalMaterial; arrow: MeshPhysicalMaterial }
  const color = state === 'current' ? '#ff5058' : state === 'completed' ? '#36434b' : '#71808b'
  jacket.color.set(color)
  jacket.emissive.set(color)
  jacket.opacity = state === 'current' ? 0.48 : state === 'completed' ? 0.11 : 0.2
  jacket.emissiveIntensity = state === 'current' ? 1.15 : 0.12
  inner.color.set(color)
  inner.emissive.set(color)
  inner.opacity = state === 'current' ? 1 : state === 'completed' ? 0.12 : 0.24
  inner.emissiveIntensity = state === 'current' ? 2.2 : 0.16
  arrow.color.set(color)
  arrow.emissive.set(color)
  arrow.opacity = state === 'current' ? 1 : state === 'completed' ? 0.16 : 0.3
  arrow.emissiveIntensity = state === 'current' ? 2 : 0.2
}

export type SceneFiber = { group: Group; curve: CatmullRomCurve3 }

export function createFiberLink(edge: AdminSceneEdge, from: Vector3, to: Vector3, index: number): SceneFiber {
  const start = from.clone().add(new Vector3(0, 0.68, 0))
  const end = to.clone().add(new Vector3(0, 0.68, 0))
  const span = start.distanceTo(end)
  const lift = Math.min(0.26 + span * 0.026, 0.72) + (index % 3) * 0.035
  const curve = new CatmullRomCurve3([
    start,
    start.clone().lerp(end, 0.34).add(new Vector3(0, lift, 0.1)),
    start.clone().lerp(end, 0.68).add(new Vector3(0, lift, -0.1)),
    end,
  ])
  const group = new Group()
  group.name = `fiber:${edge.id}`
  group.userData.edge = edge
  const baseColor = edge.color || palette.fiber
  group.userData.baseColor = baseColor
  const jacket = new MeshPhysicalMaterial({ color: baseColor, emissive: baseColor, emissiveIntensity: 0.28, transparent: true, opacity: 0.24, metalness: 0.28, roughness: 0.34, clearcoat: 0.8 })
  const inner = new MeshPhysicalMaterial({ color: baseColor, emissive: baseColor, emissiveIntensity: 1.38, transparent: true, opacity: 0.9, metalness: 0.1, roughness: 0.2 })
  const segments = Math.min(36, Math.max(12, Math.ceil(span * 3)))
  const channel = new Mesh(new TubeGeometry(curve, segments, 0.065, 6, false), jacket)
  channel.name = `fiber-channel:${edge.id}`
  group.add(channel)
  const flow = new Mesh(new TubeGeometry(curve, segments, 0.012, 5, false), inner)
  flow.name = `fiber-flow:${edge.id}`
  group.add(flow)
  const direction = new Group()
  direction.name = `fiber-direction:${edge.id}`
  const directionPosition = curve.getPointAt(0.58)
  direction.position.copy(directionPosition)
  const tangent = curve.getTangentAt(0.58).normalize()
  direction.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), tangent)
  const arrowMaterial = new MeshPhysicalMaterial({ color: baseColor, emissive: baseColor, emissiveIntensity: 1.35, transparent: true, opacity: 0.9, metalness: 0.12, roughness: 0.18, depthWrite: false })
  const arrow = new Mesh(new ConeGeometry(0.075, 0.17, 6), arrowMaterial)
  arrow.name = `fiber-arrow:${edge.id}`
  direction.add(arrow)
  group.add(direction)
  group.userData.materials = { jacket, inner, arrow: arrowMaterial }
  group.userData.directionArrow = arrow
  group.userData.flowState = 'idle'
  group.userData.flowDirection = 'forward'
  return { group, curve }
}

export function setTopologyNodeState(group: Group, state: 'normal' | 'scanning' | 'attacking' | 'compromised' | 'selected'): void {
  group.userData.visualState = state
  const factionColor = String(group.userData.baseColor ?? palette.unknown)
  const stateColor = state === 'compromised' ? palette.compromised
    : state === 'attacking' ? palette.active
      : state === 'scanning' ? '#00e5da'
        : factionColor
  const core = group.userData.core as Mesh | undefined
  const aura = group.userData.aura as Mesh | undefined
  const scanWaves = group.userData.scanWaves as Group | undefined
  const selection = group.userData.selection as Mesh | undefined
  const coreMaterial = core?.material as MeshPhysicalMaterial | undefined
  if (coreMaterial) {
    coreMaterial.color.set(factionColor)
    coreMaterial.emissive.set(factionColor)
    coreMaterial.emissiveIntensity = state === 'compromised' ? 2.3 : state === 'attacking' ? 1.8 : state === 'scanning' ? 1.25 : 0.72
  }
  if (aura) {
    const material = aura.material as MeshPhysicalMaterial
    material.color.set(stateColor)
    material.emissive.set(stateColor)
    material.emissiveIntensity = state === 'compromised' ? 2.1 : state === 'attacking' ? 1.15 : 0.75
    material.opacity = state === 'compromised' ? 0.45 : state === 'selected' ? 0.28 : state === 'normal' ? 0.12 : 0.22
  }
  if (scanWaves) {
    scanWaves.children.forEach((object) => {
      if (!(object instanceof Mesh)) return
      const material = object.material as MeshPhysicalMaterial
      material.color.set(stateColor)
      material.emissive.set(material.color)
      material.emissiveIntensity = state === 'compromised' ? 2.1 : 1.6
      object.visible = state === 'scanning' || state === 'attacking' || state === 'compromised'
    })
    scanWaves.visible = state === 'scanning' || state === 'attacking' || state === 'compromised'
  }
  if (selection) selection.visible = state === 'selected'
}

export function setFiberState(group: Group, state: 'idle' | 'scanning' | 'attacking' | 'defending' | 'compromised', focused = true, reverse = false): void {
  group.userData.flowState = state
  group.userData.focused = focused
  group.userData.flowDirection = reverse ? 'reverse' : 'forward'
  const { jacket, inner, arrow } = group.userData.materials as { jacket: MeshPhysicalMaterial; inner: MeshPhysicalMaterial; arrow: MeshPhysicalMaterial }
  const baseColor = String(group.userData.baseColor ?? palette.fiber)
  const color = state === 'attacking' ? palette.active : state === 'compromised' ? palette.compromised : state === 'defending' ? '#57e8c7' : state === 'scanning' ? '#00dfdc' : baseColor
  jacket.color.set(color)
  jacket.emissive.set(color)
  jacket.opacity = focused ? state === 'idle' ? 0.24 : 0.36 : 0.035
  jacket.emissiveIntensity = state === 'idle' ? 0.14 : state === 'compromised' ? 1.4 : 0.8
  inner.color.set(color)
  inner.emissive.set(color)
  inner.opacity = focused ? state === 'idle' ? 0.9 : 0.98 : 0.08
  inner.emissiveIntensity = state === 'idle' ? 1.05 : state === 'compromised' ? 2.2 : 1.85
  arrow.color.set(color)
  arrow.emissive.set(color)
  arrow.emissiveIntensity = focused ? state === 'attacking' || state === 'compromised' ? 1.8 : 1.1 : 0.2
  arrow.opacity = focused ? 0.92 : 0.06
  const directionArrow = group.userData.directionArrow as Mesh | undefined
  if (directionArrow) directionArrow.rotation.z = reverse ? Math.PI : 0
}

export function disposeSceneObject(root: Object3D): void {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<MeshStandardMaterial | MeshPhysicalMaterial | LineBasicMaterial>()
  root.traverse((object) => {
    if ('geometry' in object && object.geometry instanceof BufferGeometry) geometries.add(object.geometry)
    if ('material' in object) {
      const list = Array.isArray(object.material) ? object.material : [object.material]
      list.forEach((material) => {
        if (material instanceof MeshStandardMaterial || material instanceof MeshPhysicalMaterial || material instanceof LineBasicMaterial) materials.add(material)
      })
    }
  })
  geometries.forEach((geometry) => geometry.dispose())
  materials.forEach((material) => material.dispose())
}

export function statusFromNode(node: AdminSceneNode): 'normal' | 'scanning' | 'compromised' {
  if (node.kind === 'attack-jump') return 'normal'
  if (node.networkState === 'compromised') return 'compromised'
  if (isExplicitlyCompromised(node)) return 'compromised'
  if (node.status === 'running' || node.status === 'pending') return 'scanning'
  return 'normal'
}

export function isExplicitlyCompromised(node: AdminSceneNode): boolean {
  const source = node.source as unknown as Record<string, unknown> | null
  const data = source?.data && typeof source.data === 'object' ? source.data as Record<string, unknown> : source
  const type = String(source?.eventType ?? source?.type ?? data?.eventType ?? data?.type ?? '')
  const value = `${type} ${String(data?.description ?? data?.event ?? '')}`
  return data?.targetVerified === true && /compromis|breach|exploited|被攻陷|入侵成功/i.test(value)
}

export function nodeDisplayIp(node: AdminSceneNode): string {
  const source = node.source as unknown as Record<string, unknown> | null
  const data = source?.data && typeof source.data === 'object' ? source.data as Record<string, unknown> : source
  const candidate = data?.deviceIp ?? data?.ip
  return typeof candidate === 'string' ? candidate : '未记录'
}

export function nodeStatusLabel(node: AdminSceneNode): string {
  if (isExplicitlyCompromised(node)) return '已攻陷'
  if (node.status === 'running') return '活动中'
  if (node.status === 'failed') return '异常'
  if (node.status === 'completed') return '已完成'
  if (node.status === 'pending') return '等待中'
  return '状态未知'
}

export function nodeTypeLabel(node: AdminSceneNode): string {
  if (node.kind === 'attacker') return '攻击方节点'
  if (node.kind === 'defender') return '防守方节点'
  if (node.kind === 'scheduler') return '调度核心'
  if (node.kind === 'attack-jump') return '攻击跳板'
  if (node.kind === 'defender-asset') return '防守内网资产'
  if (node.kind === 'battle') return '战局节点'
  if (node.kind === 'external-case') return '案例信号'
  if (node.kind === 'security-barrier') return '分层防护屏障'
  return '事件信号'
}

export function fiberColor(color: string): Color {
  return new Color(color)
}

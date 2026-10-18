import {
  ACESFilmicToneMapping, AmbientLight, BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute,
  FogExp2, GridHelper, Group, HemisphereLight, Mesh, MeshPhysicalMaterial, Object3D,
  PerspectiveCamera, PointLight, Points, PointsMaterial, Raycaster, Scene, SphereGeometry,
  Vector2, Vector3, WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { replayEventCue, type AdminSceneModel, type AdminSceneNode } from './sceneModel'
import { createFiberLink, createTopologyNode, disposeSceneObject, isExplicitlyCompromised, nodeDisplayIp, nodeStatusLabel, nodeTypeLabel, setFiberState, setTopologyNodeState, statusFromNode } from './sceneHardware'

const EVENT_ANIMATION_DURATION_MS = 2500

export function getReplayBloomProfile(denseScene: boolean): { strength: number; radius: number; threshold: number } {
  return denseScene
    ? { strength: 0.24, radius: 0.22, threshold: 0.34 }
    : { strength: 0.4, radius: 0.32, threshold: 0.34 }
}

export class WebGLUnavailableError extends Error {
  readonly code = 'WEBGL_UNAVAILABLE'
  constructor() { super('WEBGL_UNAVAILABLE: WebGL is not supported in this environment'); this.name = 'WebGLUnavailableError' }
}

export type ThreeSceneOptions = {
  onSelectNode?: (node: AdminSceneNode) => void
  rendererFactory?: () => WebGLRenderer
}

function createStarField(): Points {
  const positions = new Float32Array(420 * 3)
  for (let index = 0; index < 420; index += 1) {
    const angle = index * 2.399963
    const radius = 5 + ((index * 37) % 100) / 10
    positions[index * 3] = Math.cos(angle) * radius
    positions[index * 3 + 1] = 1 + ((index * 17) % 100) / 12
    positions[index * 3 + 2] = Math.sin(angle) * radius
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  const points = new Points(geometry, new PointsMaterial({ color: '#4ca0b8', size: 0.018, transparent: true, opacity: 0.28, sizeAttenuation: true, depthWrite: false }))
  points.name = 'ambient-starfield'
  return points
}

function updateStatusBadge(element: HTMLElement, state: 'normal' | 'probing' | 'attacked' | 'compromised' | 'controlled', label: string): void {
  const namespace = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(namespace, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('width', '9')
  svg.setAttribute('height', '9')
  svg.setAttribute('aria-hidden', 'true')
  svg.classList.add('admin3d-status-icon')
  const add = (tag: 'circle' | 'path', attributes: Record<string, string>) => {
    const shape = document.createElementNS(namespace, tag)
    Object.entries(attributes).forEach(([key, value]) => shape.setAttribute(key, value))
    svg.appendChild(shape)
  }
  if (state === 'normal') add('circle', { cx: '7', cy: '7', r: '4.5' })
  else if (state === 'controlled' || state === 'compromised') add('path', { d: 'm4 4 8 8 M12 4l-8 8' })
  else if (state === 'probing') {
    add('circle', { cx: '6.5', cy: '6.5', r: '4' })
    add('path', { d: 'M9.5 9.5 14 14' })
  } else if (state === 'attacked') add('path', { d: 'M8 2 14 13H2L8 2Z M8 6v3 M8 11v.2' })
  element.className = `admin3d-node-status is-${state}`
  element.setAttribute('aria-label', label)
  element.replaceChildren(svg)
}

export class ThreeScene {
  private renderer?: WebGLRenderer
  private composer?: EffectComposer
  private bloomPass?: UnrealBloomPass
  private labelRenderer?: CSS2DRenderer
  private scene?: Scene
  private camera?: PerspectiveCamera
  private controls?: OrbitControls
  private container?: HTMLElement
  private model?: AdminSceneModel
  private activeNodeId?: string
  private playbackMarker?: Group
  private playbackTarget?: Vector3
  private playbackPath?: ReturnType<typeof createFiberLink>['curve']
  private playbackProgress = 0
  private playbackReversed = false
  private playbackStartedAt = 0
  private playbackAnimationRequested = false
  private packetUnits: Group[] = []
  private playbackFrame = 0
  private pulseFrame = 0
  private eventCueFrame = 0
  private impactFrame = 0
  private eventCueRemaining = 0
  private eventCueLastFrame = 0
  private playbackPaused = true
  private ambientFrame = 0
  private lastAmbientRenderAt = 0
  private hardwareGroups = new Map<string, Group>()
  private fiberGroups = new Map<string, Group>()
  private fiberCurves = new Map<string, ReturnType<typeof createFiberLink>['curve']>()
  private targetFiberId?: string
  private labels: CSS2DObject[] = []
  private eventCueLabel?: CSS2DObject
  private selectedDeviceLabel?: CSS2DObject
  private statusBadges = new Map<string, CSS2DObject>()
  private readonly raycaster = new Raycaster()
  private readonly pointer = new Vector2()
  private onClick?: (event: MouseEvent) => void
  private onResize?: () => void
  private generation = 0
  private denseScene = false

  mount(container: HTMLElement, model: AdminSceneModel, options: ThreeSceneOptions = {}): void {
    this.dispose()
    this.container = container
    this.model = model
    try {
      this.renderer = options.rendererFactory ? options.rendererFactory() : new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    } catch {
      this.container = undefined
      throw new WebGLUnavailableError()
    }
    const width = Math.max(1, container.clientWidth)
    const height = Math.max(1, container.clientHeight)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5))
    this.renderer.setSize(width, height)
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.2
    this.renderer.domElement.setAttribute('aria-label', '3D 战局事件轨迹')
    container.appendChild(this.renderer.domElement)
    if (this.renderer.shadowMap) this.renderer.shadowMap.enabled = false

    this.labelRenderer = new CSS2DRenderer()
    this.labelRenderer.setSize(width, height)
    this.labelRenderer.domElement.className = 'admin3d-label-layer'
    this.labelRenderer.domElement.setAttribute('aria-hidden', 'true')
    container.appendChild(this.labelRenderer.domElement)

    this.scene = new Scene()
    this.scene.background = new Color('#001529')
    this.scene.fog = new FogExp2('#001529', 0.018)
    this.scene.add(new AmbientLight('#b9dfff', 0.82))
    this.scene.add(new HemisphereLight('#d6edff', '#10212e', 0.92))
    const keyLight = new PointLight('#62cfff', 18, 28, 1.7)
    keyLight.position.set(-1, 7, 4)
    this.scene.add(keyLight)
    const fillLight = new PointLight('#55e8cb', 8, 22, 1.8)
    fillLight.position.set(4, 4, -4)
    this.scene.add(fillLight)
    this.scene.add(createStarField())

    const grid = new GridHelper(100, 100, '#12677e', '#123747')
    grid.name = 'infinite-tech-grid'
    grid.position.y = -0.67
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material]
    gridMaterials.forEach((material) => { material.transparent = true; material.opacity = 0.25; material.depthWrite = false })
    this.scene.add(grid)

    this.playbackMarker = this.createEnergyPacket()
    this.scene.add(this.playbackMarker)

    this.camera = new PerspectiveCamera(42, width / height, 0.1, 160)
    this.camera.position.set(0, 5, 8.8)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.set(0, 0.1, 0)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.065
    this.controls.minDistance = 3.5
    this.controls.maxDistance = 38
    this.controls.maxPolarAngle = Math.PI * 0.48
    this.controls.update()
    this.controls.addEventListener('change', this.render)
    if (!options.rendererFactory) this.initializeBloom(width, height)

    this.update(model)
    this.onResize = () => this.resize()
    window.addEventListener('resize', this.onResize)
    this.onClick = (event) => this.select(event, options.onSelectNode)
    this.renderer.domElement.addEventListener('click', this.onClick)
    this.startAmbientBreathing()
    this.render()
  }

  update(model: AdminSceneModel): void {
    this.model = model
    if (!this.scene) return
    this.hardwareGroups.forEach((group) => {
      this.scene?.remove(group)
      disposeSceneObject(group)
    })
    this.fiberGroups.forEach((group) => {
      this.scene?.remove(group)
      disposeSceneObject(group)
    })
    this.hardwareGroups.clear()
    this.fiberGroups.clear()
    this.fiberCurves.clear()
    this.targetFiberId = undefined
    if (this.eventCueLabel) { this.scene.remove(this.eventCueLabel); this.eventCueLabel.element.remove() }
    if (this.selectedDeviceLabel) { this.scene.remove(this.selectedDeviceLabel); this.selectedDeviceLabel.element.remove() }
    this.statusBadges.forEach((badge) => { this.scene?.remove(badge); badge.element.remove() })
    this.statusBadges.clear()
    this.labels.forEach((label) => { this.scene?.remove(label); label.element.remove() })
    this.labels = []
    this.selectedDeviceLabel = undefined

    this.denseScene = model.nodes.length > 24
    if (this.bloomPass) {
      const profile = getReplayBloomProfile(this.denseScene)
      this.bloomPass.strength = profile.strength
      this.bloomPass.radius = profile.radius
      this.bloomPass.threshold = profile.threshold
    }
    for (const node of model.nodes) {
      if (node.kind === 'timeline-event') continue
      const group = createTopologyNode(node)
      setTopologyNodeState(group, statusFromNode(node))
      this.hardwareGroups.set(node.id, group)
      this.scene.add(group)
      if (node.kind === 'attacker' || node.kind === 'defender' || node.kind === 'scheduler' || node.kind === 'attack-jump' || node.kind === 'defender-asset') {
        const element = document.createElement('div')
        const labelKind = node.kind === 'attack-jump' ? 'attack-jump' : node.kind === 'defender-asset' ? 'defender-asset' : node.kind
        element.className = `admin3d-node-label admin3d-node-label--${labelKind}`
        element.style.setProperty('--node-color', node.color)
        const title = document.createElement('strong')
        title.textContent = node.label
        element.appendChild(title)
        const label = new CSS2DObject(element)
        label.position.set(node.position[0], node.position[1] + (node.kind === 'attack-jump' || node.kind === 'defender-asset' ? 0.94 : 1.12), node.position[2])
        this.scene.add(label)
        this.labels.push(label)
        const badgeElement = document.createElement('span')
        const controlled = node.kind === 'attack-jump'
        updateStatusBadge(badgeElement, controlled ? 'controlled' : 'normal', controlled ? '已受控' : '正常守护')
        const badge = new CSS2DObject(badgeElement)
        const inset = node.kind === 'attacker' || node.kind === 'attack-jump' ? 0.34 : node.kind === 'defender' || node.kind === 'defender-asset' ? -0.34 : 0.34
        badge.position.copy(group.position).add(new Vector3(inset, 0.05, 0.32))
        this.scene.add(badge)
        this.statusBadges.set(node.id, badge)
      }
    }

    const nodeById = new Map(model.nodes.map((node) => [node.id, node]))
    const edges = model.edges.filter((edge) => edge.kind === 'network')
    edges.slice(0, 192).forEach((edge, index) => {
      const from = nodeById.get(edge.from)
      const to = nodeById.get(edge.to)
      if (!from || !to) return
      const fromPosition = this.hardwareGroups.get(edge.from)?.position ?? new Vector3(...from.position)
      const toPosition = this.hardwareGroups.get(edge.to)?.position ?? new Vector3(...to.position)
      const fiber = createFiberLink(edge, fromPosition, toPosition, index)
      this.fiberGroups.set(edge.id, fiber.group)
      this.fiberCurves.set(edge.id, fiber.curve)
      this.scene!.add(fiber.group)
    })

    this.applyActiveNode()
    this.applySelectedDeviceLabel()
    this.applyStatusBadges()
    this.render()
  }

  setActiveNode(id?: string, animate = false): void {
    this.activeNodeId = id
    const node = this.model?.nodes.find((item) => item.id === id)
    const targetPath = node ? this.ensureTargetFiber(node) : (this.ensureTargetFiber(undefined), undefined)
    this.applyActiveNode()
    this.applySelectedDeviceLabel()
    this.applyStatusBadges()
    const active = this.model?.nodes.find((item) => item.id === id)
    if (active?.kind === 'timeline-event') this.showEventCue(active)
    else this.clearEventCue()
    if (node && this.playbackMarker) {
      if (!animate || !targetPath) {
        cancelAnimationFrame(this.playbackFrame)
        this.playbackFrame = 0
        this.playbackAnimationRequested = false
        this.playbackProgress = 0
        this.playbackMarker.visible = false
        this.render()
        return
      }
      this.setPacketCount(node)
      this.setPacketTheme(node)
      const path = targetPath
      const target = path?.getPointAt(this.playbackReversed ? 0 : 1) ?? new Vector3(...node.position).add(new Vector3(0, 0.82, 0))
      this.positionPacketUnits(path, 0, target)
      this.playbackMarker.visible = true
      this.animateMarker(target, path, this.playbackReversed)
    } else {
      if (this.playbackMarker) this.playbackMarker.visible = false
      this.playbackAnimationRequested = false
      this.playbackProgress = 0
      cancelAnimationFrame(this.playbackFrame)
      this.playbackFrame = 0
      this.render()
    }
  }

  setPlaybackPaused(paused: boolean): void {
    if (this.playbackPaused === paused) return
    this.playbackPaused = paused
    if (paused) {
      if (this.playbackAnimationRequested && this.playbackMarker?.visible) {
        this.playbackProgress = Math.min(1, Math.max(0, (performance.now() - this.playbackStartedAt) / EVENT_ANIMATION_DURATION_MS))
        cancelAnimationFrame(this.playbackFrame)
        this.playbackFrame = 0
      }
      cancelAnimationFrame(this.eventCueFrame)
      this.eventCueFrame = 0
      if (this.eventCueLabel) this.eventCueLabel.element.dataset.paused = 'true'
      return
    }
    if (this.playbackAnimationRequested && this.playbackMarker?.visible && this.playbackTarget && !this.playbackFrame) {
      this.runPlaybackAnimation(this.playbackTarget, this.playbackPath, this.playbackProgress)
    }
    if (this.eventCueLabel && this.eventCueRemaining > 0) {
      this.eventCueLabel.element.dataset.paused = 'false'
      this.eventCueLastFrame = performance.now()
      this.eventCueFrame = requestAnimationFrame(this.advanceEventCue)
    }
  }

  resetCamera(): void {
    if (!this.camera || !this.controls) return
    this.camera.position.set(0, 5, 8.8)
    this.controls.target.set(0, 0.1, 0)
    this.controls.update()
    this.render()
  }

  dispose(): void {
    this.generation += 1
    cancelAnimationFrame(this.playbackFrame)
    cancelAnimationFrame(this.pulseFrame)
    cancelAnimationFrame(this.eventCueFrame)
    cancelAnimationFrame(this.impactFrame)
    cancelAnimationFrame(this.ambientFrame)
    if (this.onResize) window.removeEventListener('resize', this.onResize)
    if (this.renderer?.domElement && this.onClick) this.renderer.domElement.removeEventListener('click', this.onClick)
    this.hardwareGroups.forEach((group) => disposeSceneObject(group))
    this.fiberGroups.forEach((group) => disposeSceneObject(group))
    this.hardwareGroups.clear()
    this.fiberGroups.clear()
    this.fiberCurves.clear()
    this.playbackMarker?.traverse((object) => {
      if (object instanceof Mesh) {
        object.geometry.dispose()
        const material = Array.isArray(object.material) ? object.material : [object.material]
        material.forEach((item) => item.dispose())
      }
    })
    if (this.eventCueLabel) this.eventCueLabel.element.remove()
    if (this.selectedDeviceLabel) this.selectedDeviceLabel.element.remove()
    this.statusBadges.forEach((badge) => badge.element.remove())
    this.statusBadges.clear()
    this.labels.forEach((label) => label.element.remove())
    if (this.scene) {
      this.scene.traverse((object) => {
        if (object instanceof GridHelper || object instanceof Points) {
          object.geometry.dispose()
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          materials.forEach((material) => material.dispose())
        }
      })
    }
    this.composer?.dispose()
    this.composer = undefined
    this.bloomPass = undefined
    this.controls?.dispose()
    this.renderer?.dispose()
    this.renderer?.domElement.remove()
    this.labelRenderer?.domElement.remove()
    this.renderer = undefined
    this.labelRenderer = undefined
    this.scene = undefined
    this.camera = undefined
    this.controls = undefined
    this.container = undefined
    this.model = undefined
    this.activeNodeId = undefined
    this.playbackMarker = undefined
    this.playbackTarget = undefined
    this.playbackPath = undefined
    this.playbackProgress = 0
    this.playbackStartedAt = 0
    this.playbackAnimationRequested = false
    this.packetUnits = []
    this.eventCueLabel = undefined
    this.selectedDeviceLabel = undefined
    this.playbackFrame = 0
    this.pulseFrame = 0
    this.eventCueFrame = 0
    this.impactFrame = 0
    this.eventCueRemaining = 0
    this.eventCueLastFrame = 0
    this.playbackPaused = true
    this.ambientFrame = 0
    this.lastAmbientRenderAt = 0
    this.denseScene = false
    this.onClick = undefined
    this.onResize = undefined
  }

  private createEnergyPacket(): Group {
    const packet = new Group()
    packet.name = 'replay-packet'
    for (let unitIndex = 0; unitIndex < 6; unitIndex += 1) {
      const unit = new Group()
      unit.name = `replay-packet-unit-${unitIndex}`
      const scale = 1 - unitIndex * 0.055
      const shell = new Mesh(new CylinderGeometry(0.095 * scale, 0.095 * scale, 0.16 * scale, 6), new MeshPhysicalMaterial({ color: '#8feaff', emissive: '#22caff', emissiveIntensity: 1.7, transparent: true, opacity: 0.72, metalness: 0.16, roughness: 0.18, clearcoat: 1 }))
      shell.name = unitIndex === 0 ? 'replay-packet-shell' : `replay-packet-shell-${unitIndex}`
      unit.add(shell)
      const core = new Mesh(new SphereGeometry(0.042 * scale, 10, 8), new MeshPhysicalMaterial({ color: '#ffffff', emissive: '#8feeff', emissiveIntensity: 2.6, roughness: 0.12 }))
      core.name = unitIndex === 0 ? 'replay-packet-core' : `replay-packet-core-${unitIndex}`
      unit.add(core)
      const trailCount = unitIndex === 0 ? 3 : 1
      for (let index = 0; index < trailCount; index += 1) {
        const trail = new Mesh(new CylinderGeometry(0.035 - index * 0.007, 0.035 - index * 0.007, 0.1, 6), new MeshPhysicalMaterial({ color: '#43caff', emissive: '#29bbff', emissiveIntensity: 1.2 - index * 0.25, transparent: true, opacity: 0.48 - index * 0.1, metalness: 0.1, roughness: 0.2, depthWrite: false }))
        trail.name = `replay-packet-trail-${unitIndex}-${index}`
        trail.position.y = -0.13 - index * 0.08
        unit.add(trail)
      }
      packet.add(unit)
      this.packetUnits.push(unit)
    }
    packet.visible = false
    return packet
  }

  private initializeBloom(width: number, height: number): void {
    if (!this.renderer || !this.scene || !this.camera) return
    try {
      this.composer = new EffectComposer(this.renderer)
      this.composer.addPass(new RenderPass(this.scene, this.camera))
      const profile = getReplayBloomProfile(this.denseScene)
      this.bloomPass = new UnrealBloomPass(new Vector2(width, height), profile.strength, profile.radius, profile.threshold)
      this.composer.addPass(this.bloomPass)
    } catch {
      this.composer?.dispose()
      this.composer = undefined
      this.bloomPass = undefined
    }
  }

  private render = (): void => {
    if (!this.renderer || !this.scene || !this.camera) return
    this.updateLevelOfDetail()
    if (this.composer) this.composer.render()
    else this.renderer.render(this.scene, this.camera)
    this.labelRenderer?.render(this.scene, this.camera)
  }

  private updateLevelOfDetail(): void {
    if (!this.camera) return
    for (const group of this.hardwareGroups.values()) {
      const simplified = this.camera.position.distanceTo(group.position) > 17 || this.denseScene
      group.traverse((object) => {
        if (object.name.startsWith('circuit-trace:')) object.visible = !simplified
        if (object.name.startsWith('state-aura:')) {
          const material = (object as Mesh).material as MeshPhysicalMaterial
          material.opacity = simplified ? 0.08 : group.userData.visualState === 'compromised' ? 0.45 : 0.16
        }
      })
    }
  }

  resize(): void {
    if (!this.renderer || !this.camera || !this.container) return
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
    this.composer?.setSize(width, height)
    this.labelRenderer?.setSize(width, height)
    this.render()
  }

  private applyActiveNode(): void {
    if (!this.model) return
    const active = this.model.nodes.find((node) => node.id === this.activeNodeId)
    const eventSource = active?.kind === 'timeline-event' ? active.source as { eventType?: string; type?: string; data?: Record<string, unknown> } : null
    const cue = eventSource ? replayEventCue(eventSource) : undefined
    const activeActor = active?.kind === 'timeline-event' ? active.actorRole : undefined
    const targetRole = active ? this.eventTargetRole(active, cue?.kind) : undefined
    for (const node of this.model.nodes) {
      const group = this.hardwareGroups.get(node.id)
      if (!group) continue
      const selected = node.id === this.activeNodeId
      let state: 'normal' | 'scanning' | 'compromised' | 'attacking' | 'selected' = statusFromNode(node)
      if ((cue?.kind === 'defense-request' || cue?.kind === 'defense') && (node.id === 'role:attacker' || node.id === 'role:defender')) {
        state = 'scanning'
      } else if (node.id === `role:${targetRole}`) {
        if (cue?.kind === 'compromised') state = 'compromised'
        else if (cue?.kind === 'probe') state = 'scanning'
        else if (cue?.kind === 'attack' || cue?.kind === 'exploit') state = 'attacking'
      } else if (node.id === `role:${activeActor}`) {
        if (cue?.kind === 'probe') state = 'scanning'
        else if (cue?.kind === 'attack' || cue?.kind === 'exploit') state = 'attacking'
      }
      if (node.id === 'network:asset:1' && cue?.kind === 'probe') state = 'scanning'
      if (node.id === 'network:asset:1' && (cue?.kind === 'attack' || cue?.kind === 'exploit')) state = 'attacking'
      if (node.id === 'network:asset:3' && cue?.kind === 'compromised') state = 'compromised'
      if (selected && node.kind !== 'timeline-event') state = 'selected'
      if (node.kind === 'timeline-event' && selected && isExplicitlyCompromised(node)) state = 'compromised'
      group.scale.setScalar(selected && node.kind !== 'timeline-event' ? 1.06 : 1)
      setTopologyNodeState(group, state)
    }
    this.fiberGroups.forEach((group) => {
      const edge = group.userData.edge as { id: string; from: string; to: string; kind?: string }
      const participates = active?.kind === 'timeline-event' && (this.targetFiberId
        ? edge.id === this.targetFiberId
        : edge.from === active.id || edge.to === active.id)
      const focused = active?.kind !== 'timeline-event' || participates
      const state = !focused ? 'idle' : cue?.kind === 'defense' ? 'defending' : cue?.kind === 'compromised' ? 'compromised'
        : cue?.kind === 'attack' || cue?.kind === 'exploit' ? 'attacking'
          : cue?.kind === 'probe' || cue?.kind === 'defense-request' ? 'scanning' : 'idle'
      setFiberState(group, state, focused, focused && edge.id === this.targetFiberId && this.playbackReversed)
    })
    if (active?.kind === 'timeline-event') {
      const targets: Array<{ id: string; compromised: boolean }> = []
      if ((cue?.kind === 'defense-request' || cue?.kind === 'defense') && targetRole) targets.push({ id: `role:${targetRole}`, compromised: false })
      if (cue?.kind === 'probe' && (activeActor === 'attacker' || activeActor === 'defender')) targets.push({ id: `role:${activeActor}`, compromised: false })
      if (cue?.kind === 'compromised' && targetRole) targets.push({ id: `role:${targetRole}`, compromised: true })
      if (cue?.kind === 'compromised') targets.push({ id: 'network:asset:3', compromised: true })
      this.startIndicatorPulse(targets)
      if (cue?.kind === 'exploit' && targetRole) this.startImpactFlash(this.hardwareGroups.get('network:asset:2'))
    } else {
      cancelAnimationFrame(this.pulseFrame)
      this.pulseFrame = 0
      cancelAnimationFrame(this.impactFrame)
      this.impactFrame = 0
    }
  }

  private eventTargetRole(node: AdminSceneNode, kind?: string): 'attacker' | 'defender' | undefined {
    const source = node.source as { data?: { targetRole?: unknown } } | null
    const explicit = source?.data?.targetRole
    if (explicit === 'attacker' || explicit === 'defender') return explicit
    if (kind === 'defense-request') return 'defender'
    if (kind === 'defense') return 'attacker'
    if (kind && kind !== 'other' && kind !== 'session' && (node.actorRole === 'attacker' || node.actorRole === 'defender')) {
      return node.actorRole === 'attacker' ? 'defender' : 'attacker'
    }
    return undefined
  }

  private applyStatusBadges(): void {
    const active = this.model?.nodes.find((node) => node.id === this.activeNodeId && node.kind === 'timeline-event')
    const source = active?.source as { eventType?: string; type?: string; data?: Record<string, unknown> } | null
    const cue = source ? replayEventCue(source) : undefined
    const targetRole = active ? this.eventTargetRole(active, cue?.kind) : undefined
    const statuses = new Map<string, { state: 'normal' | 'probing' | 'attacked' | 'compromised' | 'controlled'; text: string }>()
    for (const id of ['attacker', 'defender', 'network:asset:1', 'network:asset:2', 'network:asset:3']) statuses.set(id.startsWith('network:') ? id : `role:${id}`, { state: 'normal', text: '正常守护' })
    for (const id of ['network:jump:1', 'network:jump:2']) statuses.set(id, { state: 'controlled', text: '已受控' })
    if (active && cue) {
      if (cue.kind === 'defense-request') statuses.set('role:defender', { state: 'probing', text: '防守检测中' })
      if (cue.kind === 'defense') {
        statuses.set('role:defender', { state: 'normal', text: '检测结果已回传' })
        statuses.set('role:attacker', { state: 'probing', text: '正在接收检测结果' })
      }
      if (cue.kind === 'probe' && active.actorRole) statuses.set(`role:${active.actorRole}`, { state: 'probing', text: '正在探测' })
      if (targetRole && cue.kind === 'probe') statuses.set(`role:${targetRole}`, { state: 'probing', text: '正在被探测' })
      if (active.actorRole && (cue.kind === 'attack' || cue.kind === 'exploit')) statuses.set(`role:${active.actorRole}`, { state: 'attacked', text: '发起攻击' })
      if (targetRole && (cue.kind === 'attack' || cue.kind === 'exploit')) statuses.set(`role:${targetRole}`, { state: 'attacked', text: '遭受攻击' })
      if (targetRole && cue.kind === 'compromised') statuses.set(`role:${targetRole}`, { state: 'compromised', text: '已沦陷' })
      if (cue.kind === 'probe') statuses.set('network:asset:1', { state: 'probing', text: '正在被探测' })
      if (cue.kind === 'attack' || cue.kind === 'exploit') statuses.set('network:asset:1', { state: 'attacked', text: '遭受攻击' })
      if (cue.kind === 'compromised') statuses.set('network:asset:3', { state: 'compromised', text: '已沦陷' })
    }
    this.statusBadges.forEach((badge, id) => {
      const state = statuses.get(id) ?? { state: 'normal' as const, text: '正常守护' }
      updateStatusBadge(badge.element, state.state, state.text)
    })
  }

  private showEventCue(node: AdminSceneNode): void {
    this.clearEventCue()
    if (!this.scene) return
    const source = node.source as { eventType?: string; type?: string; data?: Record<string, unknown> }
    const cue = replayEventCue(source)
    const actorRole = cue.kind === 'defense-request' ? 'attacker' : cue.kind === 'defense' ? 'defender' : node.actorRole
    const actor = actorRole === 'attacker' || actorRole === 'defender' ? this.hardwareGroups.get(`role:${actorRole}`) : undefined
    const targetRole = this.eventTargetRole(node, cue.kind)
    const target = targetRole ? this.hardwareGroups.get(`role:${targetRole}`) : undefined
    const center = new Vector3(0, 0.72, 0)
    const start = actor?.position.clone() ?? center.clone()
    const end = target?.position.clone() ?? center.clone()
    const element = document.createElement('div')
    element.className = `admin3d-event-cue cue-${cue.kind}`
    element.style.setProperty('--cue-color', cue.color)
    element.textContent = cue.label
    element.dataset.paused = String(this.playbackPaused)
    this.eventCueLabel = new CSS2DObject(element)
    const path = this.targetFiberId ? this.fiberCurves.get(this.targetFiberId) : undefined
    this.eventCueLabel.position.copy(path ? path.getPointAt(0.5).add(new Vector3(0, 0.72, 0)) : start.lerp(end, 0.5).add(new Vector3(0, 1.15, 0)))
    this.scene.add(this.eventCueLabel)
    this.eventCueRemaining = 2500
    if (!this.playbackPaused) {
      this.eventCueLastFrame = performance.now()
      this.eventCueFrame = requestAnimationFrame(this.advanceEventCue)
    }
  }

  private clearEventCue(): void {
    cancelAnimationFrame(this.eventCueFrame)
    this.eventCueFrame = 0
    if (this.eventCueLabel) {
      this.scene?.remove(this.eventCueLabel)
      this.eventCueLabel.element.remove()
      this.eventCueLabel = undefined
    }
    this.eventCueRemaining = 0
  }

  private advanceEventCue = (now: number): void => {
    if (this.playbackPaused || !this.eventCueLabel) return
    this.eventCueRemaining = Math.max(0, this.eventCueRemaining - Math.max(0, now - this.eventCueLastFrame))
    this.eventCueLastFrame = now
    this.eventCueLabel.element.style.opacity = String(Math.min(1, this.eventCueRemaining / 520))
    this.render()
    if (this.eventCueRemaining > 0) this.eventCueFrame = requestAnimationFrame(this.advanceEventCue)
    else this.clearEventCue()
  }

  private startImpactFlash(group?: Group): void {
    const core = group?.userData.core as Mesh | undefined
    if (!core) return
    cancelAnimationFrame(this.impactFrame)
    const material = core.material as MeshPhysicalMaterial
    const startedAt = performance.now()
    const flash = (now: number) => {
      const elapsed = now - startedAt
      material.emissiveIntensity = elapsed < 420 && Math.floor(elapsed / 70) % 2 === 0 ? 3.2 : 0.48
      this.render()
      if (elapsed < 420) this.impactFrame = requestAnimationFrame(flash)
      else {
        material.emissiveIntensity = 1.8
        this.render()
        this.impactFrame = 0
      }
    }
    this.impactFrame = requestAnimationFrame(flash)
  }

  private startAmbientBreathing(): void {
    const tick = (now: number) => {
      if (now - this.lastAmbientRenderAt >= 40) {
        this.hardwareGroups.forEach((group) => {
          if (group.userData.visualState !== 'normal') return
          const core = group.userData.core as Mesh | undefined
          if (!core) return
          const material = core.material as MeshPhysicalMaterial
          material.emissiveIntensity = 0.62 + (Math.sin(now / 760) + 1) * 0.08
        })
        this.lastAmbientRenderAt = now
        this.render()
      }
      this.ambientFrame = requestAnimationFrame(tick)
    }
    this.ambientFrame = requestAnimationFrame(tick)
  }

  private startIndicatorPulse(targets: Array<{ id: string; compromised: boolean }>): void {
    cancelAnimationFrame(this.pulseFrame)
    const activeTargets = targets.flatMap(({ id, compromised }) => {
      const group = this.hardwareGroups.get(id)
      const scanWaves = group?.userData.scanWaves as Group | undefined
      const core = group?.userData.core as Mesh | undefined
      return group && scanWaves && core ? [{ group, scanWaves, core, compromised }] : []
    })
    if (!activeTargets.length) return
    const begin = performance.now()
    const pulse = (now: number) => {
      activeTargets.forEach(({ group, scanWaves, core, compromised }) => {
        scanWaves.children.forEach((object) => {
          if (!(object instanceof Mesh)) return
          const offset = Number(object.userData.phase ?? 0)
          const phase = ((now - begin) / (compromised ? 1050 : 1500) + offset) % 1
          object.scale.setScalar(0.72 + phase * 1.25)
          ;(object.material as MeshPhysicalMaterial).opacity = (1 - phase) * (compromised ? 0.78 : 0.58)
        })
        const coreMaterial = core.material as MeshPhysicalMaterial
        coreMaterial.emissiveIntensity = compromised ? 1.4 + (Math.sin((now - begin) / 90) + 1) * 1.05 : 1.05 + (Math.sin((now - begin) / 220) + 1) * 0.34
        group.userData.visualState = compromised ? 'compromised' : group.userData.visualState
      })
      this.render()
      this.pulseFrame = requestAnimationFrame(pulse)
    }
    this.pulseFrame = requestAnimationFrame(pulse)
  }

  private applySelectedDeviceLabel(): void {
    if (this.selectedDeviceLabel && this.scene) {
      this.scene.remove(this.selectedDeviceLabel)
      this.selectedDeviceLabel.element.remove()
      this.selectedDeviceLabel = undefined
    }
    const node = this.model?.nodes.find((item) => item.id === this.activeNodeId)
    if (!node || !this.scene) return
    if (node.kind === 'timeline-event') return
    const element = document.createElement('div')
    element.className = 'admin3d-node-label admin3d-node-label--selected-device'
    const title = document.createElement('strong')
    title.textContent = node.label
    const details = document.createElement('span')
    details.textContent = `${nodeTypeLabel(node)} · ${nodeStatusLabel(node)} · ${nodeDisplayIp(node)}`
    element.append(title, details)
    this.selectedDeviceLabel = new CSS2DObject(element)
    this.selectedDeviceLabel.position.set(node.position[0], node.position[1] + 1.05, node.position[2])
    this.scene.add(this.selectedDeviceLabel)
  }

  private setPacketCount(node: AdminSceneNode): void {
    const source = node.source as { eventType?: string; type?: string; data?: { description?: string; event?: string; caught?: unknown[] } } | null
    const cue = source ? replayEventCue(source) : undefined
    const eventType = cue?.kind === 'compromised' ? 'attack.compromised' : cue?.kind === 'attack' || cue?.kind === 'exploit' ? 'attack.started' : cue?.kind === 'probe' ? 'attack.probe.started' : ''
    const description = ''
    const count = cue?.kind === 'defense' ? Math.min(6, 3 + (source?.data?.caught?.length ?? 0))
      : cue?.kind === 'defense-request' ? 3
        : /compromis|breach|exploited|入侵成功|被攻陷/.test(`${eventType} ${description}`) ? 6
      : eventType.startsWith('attack.') ? 5
        : /probe|scan|探测|扫描/.test(`${eventType} ${description}`) ? 3 : 2
    this.packetUnits.forEach((unit, index) => { unit.visible = index < count })
  }

  private setPacketTheme(node: AdminSceneNode): void {
    const source = node.source as { eventType?: string; type?: string; data?: Record<string, unknown> } | null
    const cue = source ? replayEventCue(source) : undefined
    const color = cue?.kind === 'probe' || cue?.kind === 'defense-request' ? '#00dfdc' : cue?.color ?? '#76cfff'
    this.packetUnits.forEach((unit) => unit.traverse((object) => {
      if (!(object instanceof Mesh)) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach((material) => {
        if (!(material instanceof MeshPhysicalMaterial)) return
        material.color.set(object.name.includes('core') ? '#ffffff' : color)
        material.emissive.set(color)
      })
    }))
  }

  private positionPacketUnits(path: ReturnType<typeof createFiberLink>['curve'] | undefined, progress: number, target: Vector3): void {
    const active = this.packetUnits.filter((unit) => unit.visible)
    active.forEach((unit, index) => {
      if (path) {
        const position = this.playbackReversed
          ? Math.max(0, Math.min(1, 1 - progress + index * 0.11))
          : Math.max(0, Math.min(1, progress - index * 0.11))
        unit.position.copy(path.getPointAt(position))
        const tangent = path.getTangentAt(position).normalize()
        if (this.playbackReversed) tangent.negate()
        unit.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), tangent)
      } else unit.position.copy(target)
    })
  }

  private animateMarker(target: Vector3, path?: ReturnType<typeof createFiberLink>['curve'], reversed = false): void {
    if (!this.playbackMarker) return
    cancelAnimationFrame(this.playbackFrame)
    this.playbackTarget = target.clone()
    this.playbackPath = path
    this.playbackReversed = reversed
    this.playbackProgress = 0
    this.playbackAnimationRequested = true
    this.playbackMarker.visible = true
    this.runPlaybackAnimation(target, path, 0)
  }

  private runPlaybackAnimation(target: Vector3, path: ReturnType<typeof createFiberLink>['curve'] | undefined, startProgress: number): void {
    if (!this.playbackMarker) return
    cancelAnimationFrame(this.playbackFrame)
    const beganAt = performance.now() - startProgress * EVENT_ANIMATION_DURATION_MS
    this.playbackStartedAt = beganAt
    const step = (now: number) => {
      const progress = Math.min((now - beganAt) / EVENT_ANIMATION_DURATION_MS, 1)
      this.playbackProgress = progress
      const eased = progress * progress * (3 - 2 * progress)
      this.positionPacketUnits(path, eased, target)
      this.render()
      if (progress < 1) this.playbackFrame = requestAnimationFrame(step)
      else if (this.playbackMarker) {
        this.playbackMarker.visible = false
        this.playbackAnimationRequested = false
        this.playbackFrame = 0
        this.render()
      }
    }
    this.playbackFrame = requestAnimationFrame(step)
  }

  private ensureTargetFiber(node?: AdminSceneNode): ReturnType<typeof createFiberLink>['curve'] | undefined {
    const source = node?.source as { eventType?: string; type?: string; data?: Record<string, unknown> } | null
    const cue = source ? replayEventCue(source) : undefined
    this.playbackReversed = false
    if (node?.kind === 'timeline-event' && (cue?.kind === 'defense-request' || cue?.kind === 'defense')) {
      const roundValue = source?.data?.round
      const round = typeof roundValue === 'number' && Number.isFinite(roundValue) ? Math.max(1, roundValue) : 1
      const routeId = round % 2 === 1 ? 'network-path:3' : 'network-path:6'
      this.targetFiberId = routeId
      this.playbackReversed = cue.kind === 'defense'
      return this.fiberCurves.get(routeId)
    }
    const explicitTarget = source?.data?.targetRole
    const actorRole = node?.actorRole
    const targetRole = explicitTarget === 'attacker' || explicitTarget === 'defender'
      ? explicitTarget
      : cue && cue.kind !== 'other' && cue.kind !== 'session' && (actorRole === 'attacker' || actorRole === 'defender')
        ? actorRole === 'attacker' ? 'defender' : 'attacker'
        : undefined
    if (node?.kind !== 'timeline-event' || (targetRole !== 'attacker' && targetRole !== 'defender') || (actorRole !== 'attacker' && actorRole !== 'defender') || targetRole === actorRole) {
      this.targetFiberId = undefined
      return undefined
    }
    const eventIndex = Math.max(0, this.model?.nodes.filter((item) => item.kind === 'timeline-event').findIndex((item) => item.id === node.id) ?? 0)
    const routeIndex = eventIndex % 2
    const pathIndex = cue?.kind === 'probe' ? 1 + routeIndex
      : cue?.kind === 'attack' ? routeIndex ? 6 : 3
        : cue?.kind === 'exploit' ? routeIndex ? 5 : 4
          : cue?.kind === 'compromised' ? 7 + eventIndex % 3 : 3
    const id = `network-path:${pathIndex}`
    this.targetFiberId = id
    return this.fiberCurves.get(id)
  }

  private focusNode(node: AdminSceneNode): void {
    if (!this.camera || !this.controls) return
    const target = new Vector3(...node.position)
    const offset = this.camera.position.clone().sub(this.controls.target)
    if (offset.length() < 3.5) offset.set(0, 2.4, 4.2)
    this.controls.target.copy(target)
    this.camera.position.copy(target).add(offset)
    this.controls.update()
  }

  private select(event: MouseEvent, onSelect?: (node: AdminSceneNode) => void): void {
    if (!this.renderer || !this.camera || !this.model || !onSelect) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hit = this.raycaster.intersectObjects([...this.hardwareGroups.values()], true)[0]
    let object: Object3D | undefined = hit?.object
    while (object && typeof object.userData.sceneNodeId !== 'string') object = object.parent ?? undefined
    const node = typeof object?.userData.sceneNodeId === 'string'
      ? this.model.nodes.find((item) => item.id === object!.userData.sceneNodeId)
      : undefined
    if (!node) return
    this.setActiveNode(node.id)
    this.focusNode(node)
    onSelect(node)
  }
}

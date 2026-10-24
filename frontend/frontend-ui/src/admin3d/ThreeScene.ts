import {
  ACESFilmicToneMapping, AmbientLight, BufferGeometry, CatmullRomCurve3, Color, Float32BufferAttribute,
  FogExp2, GridHelper, Group, HemisphereLight, Mesh, MeshPhysicalMaterial, Object3D,
  PerspectiveCamera, PointLight, Points, PointsMaterial, Raycaster, Scene,
  Vector2, Vector3, WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import type { Pass } from 'three/addons/postprocessing/Pass.js'
import { replayEventCue, securityPathTheme, type AdminSceneModel, type AdminSceneNode } from './sceneModel'
import { createFiberLink, createTopologyNode, disposeSceneObject, isExplicitlyCompromised, nodeDisplayIp, nodeStatusLabel, nodeTypeLabel, setFiberProgressState, setFiberState, setTopologyNodeState, statusFromNode } from './sceneHardware'
import { attackRouteFiberIds, createSecurityRoute, routeProgressAtPoint, routeProgressBoundaries, selectEventFiberRoute } from './NetworkLayout'
import { EventCuePlayer, eventStatusBadges, eventTargetRole, updateStatusBadge } from './SceneEvents'
import { applySecurityTheme, BarrierFeedbackPlayer, clearBarrierFeedback, createSecurityBarriers, type SecurityBarriers } from './BarrierRenderer'
import { PacketPlayer } from './PacketPlayer'
import type { AdminBattleScore } from '../adminApi'

const EVENT_ANIMATION_DURATION_MS = 2500
export function getReplayBloomProfile(denseScene: boolean): { strength: number; radius: number; threshold: number } {
  return denseScene
    ? { strength: 0.24, radius: 0.22, threshold: 0.34 }
    : { strength: 0.4, radius: 0.32, threshold: 0.34 }
}

export function getReplayPostprocessingPasses(scene: Scene, camera: PerspectiveCamera, width: number, height: number, denseScene: boolean): Pass[] {
  const profile = getReplayBloomProfile(denseScene)
  return [
    new RenderPass(scene, camera),
    new UnrealBloomPass(new Vector2(width, height), profile.strength, profile.radius, profile.threshold),
    new SMAAPass(),
    new OutputPass(),
  ]
}

export class WebGLUnavailableError extends Error {
  readonly code = 'WEBGL_UNAVAILABLE'
  constructor() { super('WEBGL_UNAVAILABLE: WebGL is not supported in this environment'); this.name = 'WebGLUnavailableError' }
}

export type ThreeSceneOptions = {
  onSelectNode?: (node: AdminSceneNode) => void
  rendererFactory?: () => WebGLRenderer
}

function attackTargetAssetId(data: Record<string, unknown>, compromised: boolean): string {
  const targetAssetId = data.targetAssetId
  if (targetAssetId === 'network:asset:1' || targetAssetId === 'network:asset:2' || targetAssetId === 'network:asset:3') return targetAssetId
  return compromised ? 'network:asset:3' : 'network:asset:1'
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
  private packetPlayer?: PacketPlayer
  private playbackTarget?: Vector3
  private playbackPath?: ReturnType<typeof createFiberLink>['curve']
  private playbackRoute?: CatmullRomCurve3
  private playbackProgress = 0
  private playbackReversed = false
  private playbackStartedAt = 0
  private playbackAnimationRequested = false
  private packetUnits: Group[] = []
  private playbackFrame = 0
  private pulseFrame = 0
  private impactFrame = 0
  private playbackPaused = true
  private ambientFrame = 0
  private lastAmbientRenderAt = 0
  private hardwareGroups = new Map<string, Group>()
  private fiberGroups = new Map<string, Group>()
  private fiberCurves = new Map<string, ReturnType<typeof createFiberLink>['curve']>()
  private targetFiberId?: string
  private labels: CSS2DObject[] = []
  private readonly eventCue = new EventCuePlayer(() => this.render())
  private selectedDeviceLabel?: CSS2DObject
  private statusBadges = new Map<string, CSS2DObject>()
  private securityBarriers = new Map<number, Group>()
  private securityBarrierLabels = new Map<number, CSS2DObject>()
  private securityBarrierStats = new Map<number, CSS2DObject>()
  private barrierCollection: SecurityBarriers = { groups: this.securityBarriers, labels: this.securityBarrierLabels, stats: this.securityBarrierStats }
  private readonly barrierFeedback = new BarrierFeedbackPlayer(() => this.render())
  private focusedFiberIds = new Set<string>()
  private activeAttackRouteIds: string[] = []
  private activeAttackRouteBoundaries: number[] = []
  private playbackOutcome?: { status: 'intercepted' | 'penetrated' | 'compromised'; barrierIndex: number; intercepted?: number; total?: number; targetAssetId: string; triggerProgress: number }
  private barrierFeedbackTriggered = false
  private securityTheme = securityPathTheme()
  private nodeQuery = ''
  private readonly raycaster = new Raycaster()
  private readonly pointer = new Vector2()
  private onSelectNode?: (node: AdminSceneNode) => void
  private onClick?: (event: MouseEvent) => void
  private viewLockedNodeId?: string
  private onContextMenu?: (event: MouseEvent) => void
  private onLabelClickRoot?: HTMLElement
  private onResize?: () => void
  private generation = 0
  private denseScene = false
  private defaultCameraDistance = 8.8

  mount(container: HTMLElement, model: AdminSceneModel, options: ThreeSceneOptions = {}): void {
    this.dispose()
    this.container = container
    this.model = model
    this.onSelectNode = options.onSelectNode
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
    // CSS2D labels sit above the WebGL canvas. Delegate from the renderer root so
    // clicks on nested text nodes (and labels recreated during update()) cannot be lost.
    this.onLabelClickRoot = this.labelRenderer.domElement
    this.onLabelClickRoot.addEventListener('click', this.onLabelClick, true)
    this.onContextMenu = (event) => this.handleContextMenu(event)
    this.onLabelClickRoot.addEventListener('contextmenu', this.onContextMenu, true)
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

    this.packetPlayer = new PacketPlayer()
    this.playbackMarker = this.packetPlayer.marker
    this.packetUnits = this.packetPlayer.units
    this.scene.add(this.playbackMarker)

    this.camera = new PerspectiveCamera(42, width / height, 0.1, 160)
    const xPositions = model.nodes.map((node) => node.position[0])
    const sceneSpan = xPositions.length ? Math.max(...xPositions) - Math.min(...xPositions) : 0
    const aspect = width / Math.max(height, 1)
    this.defaultCameraDistance = Math.min(68, Math.max(8.8, sceneSpan / (2 * Math.tan((42 * Math.PI / 180) / 2) * Math.max(aspect, 0.5)) * 1.12))
    const cameraElevation = 34 * Math.PI / 180
    this.camera.position.set(0, 0.1 + this.defaultCameraDistance * Math.sin(cameraElevation), this.defaultCameraDistance * Math.cos(cameraElevation))
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.set(0, 0.1, 0)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.065
    this.controls.minDistance = 3.5
    this.controls.maxDistance = 70
    this.controls.maxPolarAngle = Math.PI * 0.48
    this.controls.update()
    this.controls.addEventListener('change', this.render)
    if (!options.rendererFactory) this.initializeBloom(width, height)

    this.update(model)
    this.onResize = () => this.resize()
    window.addEventListener('resize', this.onResize)
    this.onClick = (event) => this.select(event, options.onSelectNode)
    this.renderer.domElement.addEventListener('click', this.onClick)
    this.renderer.domElement.addEventListener('contextmenu', this.onContextMenu)
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
    this.securityBarriers.forEach((group) => {
      this.scene?.remove(group)
      disposeSceneObject(group)
    })
    this.fiberGroups.forEach((group) => {
      this.scene?.remove(group)
      disposeSceneObject(group)
    })
    this.hardwareGroups.clear()
    this.securityBarriers.clear()
    this.fiberGroups.clear()
    this.fiberCurves.clear()
    this.targetFiberId = undefined
    this.eventCue.clear(this.scene)
    if (this.selectedDeviceLabel) { this.scene.remove(this.selectedDeviceLabel); this.selectedDeviceLabel.element.remove() }
    this.statusBadges.forEach((badge) => { this.scene?.remove(badge); badge.element.remove() })
    this.statusBadges.clear()
    this.labels.forEach((label) => { this.scene?.remove(label); label.element.remove() })
    this.labels = []
    this.selectedDeviceLabel = undefined
    this.securityBarrierLabels.forEach((label) => { this.scene?.remove(label); label.element.remove() })
    this.securityBarrierLabels.clear()
    this.securityBarrierStats.forEach((label) => { this.scene?.remove(label); label.element.remove() })
    this.securityBarrierStats.clear()

    this.denseScene = model.nodes.length > 24
    if (this.bloomPass) {
      const profile = getReplayBloomProfile(this.denseScene)
      this.bloomPass.strength = profile.strength
      this.bloomPass.radius = profile.radius
      this.bloomPass.threshold = profile.threshold
    }
    for (const node of model.nodes) {
      if (node.kind === 'timeline-event' || node.kind === 'security-barrier') continue
      const group = createTopologyNode(node)
      setTopologyNodeState(group, statusFromNode(node))
      this.hardwareGroups.set(node.id, group)
      this.scene.add(group)
      if (node.kind === 'attacker' || node.kind === 'defender' || node.kind === 'scheduler' || node.kind === 'attack-jump' || node.kind === 'defender-asset' || node.kind === 'external-case') {
        const element = document.createElement('div')
        const labelKind = node.kind === 'attack-jump' ? 'attack-jump' : node.kind === 'defender-asset' ? 'defender-asset' : node.kind
        element.className = `admin3d-node-label admin3d-node-label--${labelKind}`
        element.dataset.sceneNodeId = node.id
        element.style.setProperty('--node-color', node.color)
        const title = document.createElement('strong')
        title.textContent = node.label
        element.appendChild(title)
         if ((node.kind === 'attacker' || node.kind === 'defender') && model.score) {
           const roleScore: AdminBattleScore['attacker'] | undefined = node.kind === 'attacker' ? model.score.attacker : model.score.defender
           if (typeof roleScore?.score === 'number' && typeof roleScore.maxScore === 'number') {
             const score = document.createElement('span')
             score.className = 'admin3d-node-score'
             score.textContent = `评分 ${roleScore.score}/${roleScore.maxScore}`
             element.appendChild(score)
           }
         }
        const label = new CSS2DObject(element)
        label.position.set(node.position[0], node.position[1] + (node.kind === 'attack-jump' || node.kind === 'defender-asset' ? 0.94 : node.kind === 'external-case' ? 0.86 : 1.12), node.position[2])
        this.scene.add(label)
        this.labels.push(label)
        const badgeElement = document.createElement('span')
        const controlled = node.kind === 'attack-jump'
        updateStatusBadge(badgeElement, controlled ? 'controlled' : 'normal', controlled ? '已受控' : '正常守护')
        const badge = new CSS2DObject(badgeElement)
        const inset = node.kind === 'defender' || node.kind === 'defender-asset' ? -0.34 : 0.34
        badge.position.copy(group.position).add(new Vector3(inset, 0.05, 0.32))
        this.scene.add(badge)
        this.statusBadges.set(node.id, badge)
      }
    }

    this.barrierCollection = createSecurityBarriers(this.scene, model)
    this.securityBarriers = this.barrierCollection.groups
    this.securityBarrierLabels = this.barrierCollection.labels
    this.securityBarrierStats = this.barrierCollection.stats
    this.securityTheme = securityPathTheme(model.topic)
    applySecurityTheme(this.barrierCollection, this.securityTheme)
    const nodeById = new Map(model.nodes.map((node) => [node.id, node]))
    model.edges.slice(0, 512).forEach((edge, index) => {
      const from = nodeById.get(edge.from)
      const to = nodeById.get(edge.to)
      const barrierGroup = (id: string) => id.startsWith('security:barrier:')
        ? this.securityBarriers.get(Number(id.split(':').at(-1)) - 1)
        : undefined
      const fromGroup = this.hardwareGroups.get(edge.from) ?? barrierGroup(edge.from)
      const toGroup = this.hardwareGroups.get(edge.to) ?? barrierGroup(edge.to)
      if (!from || !to || !fromGroup || !toGroup) return
      const fromPosition = fromGroup.position
      const toPosition = toGroup.position
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
    this.preparePlaybackFeedback(node)
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
      this.packetPlayer?.setCount(node, this.model)
      this.packetPlayer?.setTheme(node)
      const path = this.playbackRoute ?? targetPath
      const target = path?.getPointAt(this.playbackReversed ? 0 : 1) ?? new Vector3(...node.position).add(new Vector3(0, 0.82, 0))
      this.packetPlayer?.position(path, 0, target, this.playbackReversed)
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

  /** Mirrors the 2D event search in the 3D view by dimming unrelated nodes and links. */
  setNodeQuery(query: string): void {
    this.nodeQuery = query.trim().toLocaleLowerCase()
    this.applySearchQuery()
    this.render()
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
      this.eventCue.setPaused(true)
      return
    }
    if (this.playbackAnimationRequested && this.playbackMarker?.visible && this.playbackTarget && !this.playbackFrame) {
      this.runPlaybackAnimation(this.playbackTarget, this.playbackPath, this.playbackProgress)
    }
    this.eventCue.setPaused(false)
  }

  resetCamera(): void {
    if (!this.camera || !this.controls) return
    this.viewLockedNodeId = undefined
    this.controls.enabled = true
    const cameraElevation = 34 * Math.PI / 180
    this.camera.position.set(0, 0.1 + this.defaultCameraDistance * Math.sin(cameraElevation), this.defaultCameraDistance * Math.cos(cameraElevation))
    this.controls.target.set(0, 0.1, 0)
    this.controls.update()
    this.render()
  }

  /** Releases the node focus without changing the selected node details. */
  unlockView(): void {
    const wasLocked = this.viewLockedNodeId !== undefined
    this.viewLockedNodeId = undefined
    if (this.controls) this.controls.enabled = true
    if (wasLocked || this.renderer) this.render()
  }

  dispose(): void {
    this.generation += 1
    cancelAnimationFrame(this.playbackFrame)
    cancelAnimationFrame(this.pulseFrame)
    cancelAnimationFrame(this.impactFrame)
    this.barrierFeedback.cancel()
    cancelAnimationFrame(this.ambientFrame)
    if (this.onResize) window.removeEventListener('resize', this.onResize)
    if (this.renderer?.domElement && this.onClick) this.renderer.domElement.removeEventListener('click', this.onClick)
    if (this.renderer?.domElement && this.onContextMenu) this.renderer.domElement.removeEventListener('contextmenu', this.onContextMenu)
    this.onLabelClickRoot?.removeEventListener('click', this.onLabelClick, true)
    if (this.onLabelClickRoot && this.onContextMenu) this.onLabelClickRoot.removeEventListener('contextmenu', this.onContextMenu, true)
    this.hardwareGroups.forEach((group) => disposeSceneObject(group))
    this.securityBarriers.forEach((group) => disposeSceneObject(group))
    this.fiberGroups.forEach((group) => disposeSceneObject(group))
    this.hardwareGroups.clear()
    this.securityBarriers.clear()
    this.fiberGroups.clear()
    this.fiberCurves.clear()
    this.packetPlayer?.dispose()
    this.eventCue.clear(this.scene)
    if (this.selectedDeviceLabel) this.selectedDeviceLabel.element.remove()
    this.statusBadges.forEach((badge) => badge.element.remove())
    this.statusBadges.clear()
    this.labels.forEach((label) => label.element.remove())
    this.securityBarrierLabels.forEach((label) => label.element.remove())
    this.securityBarrierStats.forEach((label) => label.element.remove())
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
    this.nodeQuery = ''
    this.activeNodeId = undefined
    this.playbackMarker = undefined
    this.packetPlayer = undefined
    this.playbackTarget = undefined
    this.playbackPath = undefined
    this.playbackRoute = undefined
    this.playbackProgress = 0
    this.playbackStartedAt = 0
    this.playbackAnimationRequested = false
    this.packetUnits = []
    this.selectedDeviceLabel = undefined
    this.playbackFrame = 0
    this.pulseFrame = 0
    this.impactFrame = 0
    this.playbackPaused = true
    this.ambientFrame = 0
    this.lastAmbientRenderAt = 0
    this.denseScene = false
    this.securityBarrierLabels.clear()
    this.securityBarrierStats.clear()
    this.focusedFiberIds.clear()
    this.activeAttackRouteIds = []
    this.activeAttackRouteBoundaries = []
    this.playbackOutcome = undefined
    this.barrierFeedbackTriggered = false
    this.onClick = undefined
    this.onContextMenu = undefined
    this.viewLockedNodeId = undefined
    this.onLabelClickRoot = undefined
    this.onSelectNode = undefined
    this.onResize = undefined
  }

  resetSecurityPath(): void {
    this.playbackOutcome = undefined
    this.barrierFeedbackTriggered = false
    this.focusedFiberIds.clear()
    this.activeAttackRouteIds = []
    this.activeAttackRouteBoundaries = []
    clearBarrierFeedback(this.scene, this.barrierCollection)
    this.packetUnits.forEach((unit) => { unit.visible = false })
    if (this.playbackMarker) this.playbackMarker.visible = false
    applySecurityTheme(this.barrierCollection, this.securityTheme)
    this.applyActiveNode()
    this.render()
  }

  getSecurityTheme(): { name: string; focusedLayers: number[] } {
    return { name: this.securityTheme.name, focusedLayers: [...this.securityTheme.focusedLayers] }
  }

  private initializeBloom(width: number, height: number): void {
    if (!this.renderer || !this.scene || !this.camera) return
    try {
      this.composer = new EffectComposer(this.renderer)
      const passes = getReplayPostprocessingPasses(this.scene, this.camera, width, height, this.denseScene)
      this.bloomPass = passes[1] as UnrealBloomPass
      passes.forEach((pass) => this.composer?.addPass(pass))
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

  private preparePlaybackFeedback(node?: AdminSceneNode): void {
    clearBarrierFeedback(this.scene, this.barrierCollection)
    this.playbackRoute = undefined
    this.playbackOutcome = undefined
    this.barrierFeedbackTriggered = false
    if (this.packetPlayer) this.packetPlayer.visualState = 'attack'
    this.focusedFiberIds.clear()
    if (node?.kind !== 'timeline-event') return
    const source = node.source as { eventType?: string; type?: string; data?: Record<string, unknown> } | null
    const cue = source ? replayEventCue(source) : undefined
    const eventType = String(source?.eventType ?? source?.type ?? '').toLowerCase()
    const isDefenseCompleted = eventType === 'defense.completed'
    if (!cue || (!['probe', 'attack', 'exploit', 'compromised'].includes(cue.kind) && !isDefenseCompleted)) return
    const data = source?.data ?? {}
    const targetAssetId = attackTargetAssetId(data, cue.kind === 'compromised')
    const layerInterceptions = data.layerInterceptions && typeof data.layerInterceptions === 'object'
      ? data.layerInterceptions as { layers?: unknown; total?: unknown }
      : undefined
    const layerStats = Array.isArray(layerInterceptions?.layers)
      ? layerInterceptions.layers.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      : []
    const blockedLayer = layerStats.find((item) => typeof item.blocked === 'number' && Number.isFinite(item.blocked) && item.blocked > 0)
    const selectedLayer = blockedLayer ?? layerStats.find((item) => typeof item.layer === 'number')
    const configuredLayer = selectedLayer?.layer ?? [data.layer, data.layerIndex, data.securityLayer, data.blockedLayer].find((value) => typeof value === 'number')
    const barrierIndex = typeof configuredLayer === 'number'
      ? Math.max(0, Math.min(3, configuredLayer > 0 ? configuredLayer - 1 : configuredLayer))
      : undefined
    const verifiedCompromise = cue.kind === 'compromised' && data.targetVerified === true
    const penetrated = data.penetrated === true
    const interceptedValue = selectedLayer?.blocked ?? data.interceptedCount
    const intercepted = typeof interceptedValue === 'number' && Number.isFinite(interceptedValue) ? Math.max(0, interceptedValue) : undefined
    const reachedValue = selectedLayer?.reached ?? selectedLayer?.total
    const total = typeof reachedValue === 'number' && Number.isFinite(reachedValue)
      ? Math.max(0, reachedValue)
      : typeof layerInterceptions?.total === 'number' && Number.isFinite(layerInterceptions.total)
        ? Math.max(0, layerInterceptions.total)
        : undefined
    this.playbackRoute = createSecurityRoute(this.hardwareGroups, this.securityBarriers, targetAssetId)
    this.activeAttackRouteIds = attackRouteFiberIds(targetAssetId)
    const routeNodes = ['network:jump:1', 'network:jump:2', 'security:barrier:1', 'security:barrier:2', 'security:barrier:3', 'security:barrier:4', targetAssetId, 'role:defender']
    this.activeAttackRouteBoundaries = routeProgressBoundaries(this.playbackRoute, routeNodes.flatMap((id) => {
      const group = this.hardwareGroups.get(id) ?? (id.startsWith('security:barrier:') ? this.securityBarriers.get(Number(id.split(':').at(-1))! - 1) : undefined)
      return group ? [group.position.clone().add(new Vector3(0, 0.68, 0))] : []
    }))
    this.activeAttackRouteIds.forEach((id) => this.focusedFiberIds.add(id))
    const target = this.hardwareGroups.get(targetAssetId)
    const targetProgress = target ? routeProgressAtPoint(this.playbackRoute, target.position) : undefined
    if (verifiedCompromise) {
      if (targetProgress === undefined) return
      this.playbackOutcome = { status: 'compromised', barrierIndex: barrierIndex ?? 3, targetAssetId, triggerProgress: targetProgress }
      return
    }
    if (barrierIndex === undefined || intercepted === undefined || total === undefined || (!penetrated && intercepted <= 0)) return
    const barrier = this.securityBarriers.get(barrierIndex)
    const barrierProgress = barrier ? routeProgressAtPoint(this.playbackRoute, barrier.position) : undefined
    const triggerProgress = penetrated ? targetProgress : barrierProgress
    if (triggerProgress === undefined) return
    this.playbackOutcome = { status: penetrated ? 'penetrated' : 'intercepted', barrierIndex, intercepted: Math.min(total, intercepted), total, targetAssetId, triggerProgress }
  }

  private startBarrierPulse(index: number, outcome: 'intercepted' | 'penetrated', intercepted?: number, total?: number): void {
    cancelAnimationFrame(this.impactFrame)
    this.impactFrame = 0
    this.barrierFeedback.pulse(this.scene, this.barrierCollection, this.securityTheme, index, outcome, intercepted, total)
  }

  private startDefenseCompletionFlash(): void {
    cancelAnimationFrame(this.impactFrame)
    this.impactFrame = 0
    this.barrierFeedback.flashDefense(this.barrierCollection, this.securityTheme)
  }

  private updatePlaybackFeedback(progress: number): void {
    this.updateAttackRouteProgress(progress)
    const outcome = this.playbackOutcome
    if (!outcome || this.barrierFeedbackTriggered) return
    if (progress < outcome.triggerProgress) return
    this.barrierFeedbackTriggered = true
    if (outcome.status === 'intercepted') {
      this.packetPlayer?.setVisualState('intercepted')
      this.startBarrierPulse(outcome.barrierIndex, outcome.status, outcome.intercepted, outcome.total)
      this.packetPlayer?.position(this.playbackRoute, outcome.triggerProgress, new Vector3(), this.playbackReversed)
    } else if (outcome.status === 'penetrated') {
      this.packetPlayer?.setVisualState('penetrated')
      this.startBarrierPulse(outcome.barrierIndex, outcome.status, outcome.intercepted, outcome.total)
      this.startIndicatorPulse([{ id: outcome.targetAssetId, compromised: false }])
    } else {
      this.packetPlayer?.setVisualState('compromised')
      this.startIndicatorPulse([{ id: outcome.targetAssetId, compromised: true }])
    }
  }

  private updateAttackRouteProgress(progress: number): void {
    if (!this.activeAttackRouteIds.length) return
    const normalizedProgress = Math.max(0, Math.min(1, progress))
    const currentIndex = this.activeAttackRouteBoundaries.findIndex((boundary) => normalizedProgress < boundary)
    this.activeAttackRouteIds.forEach((id, index) => {
      const fiber = this.fiberGroups.get(id)
      if (!fiber) return
      setFiberProgressState(fiber, currentIndex === -1 || index < currentIndex ? 'completed' : index === currentIndex ? 'current' : 'pending')
    })
  }

  private applySearchQuery(): void {
    if (!this.model) return
    const query = this.nodeQuery
    const nodeText = (node: AdminSceneNode): string => `${node.label} ${JSON.stringify(node.source ?? '')}`.toLocaleLowerCase()
    const matchedNodeIds = new Set(this.model.nodes.filter((node) => !query || nodeText(node).includes(query)).map((node) => node.id))
    const focusedRouteIds = new Set<string>()
    if (query && this.activeNodeId) {
      this.fiberGroups.forEach((group) => {
        if (group.userData.focused === false) return
        const edge = group.userData.edge as { from: string; to: string } | undefined
        if (edge) { focusedRouteIds.add(edge.from); focusedRouteIds.add(edge.to) }
      })
    }
    const visibleNodeIds = new Set([...matchedNodeIds, ...focusedRouteIds])
    this.hardwareGroups.forEach((group, id) => {
      const dimmed = Boolean(query) && !visibleNodeIds.has(id)
      group.userData.searchDimmed = dimmed
      group.traverse((object) => {
        if (!('material' in object)) return
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        materials.forEach((material) => {
          if (!material || typeof material.opacity !== 'number') return
          const baseOpacity = typeof material.userData.admin3dSearchOpacity === 'number'
            ? material.userData.admin3dSearchOpacity
            : (material.userData.admin3dSearchOpacity = material.opacity)
          material.opacity = dimmed ? baseOpacity * 0.16 : baseOpacity
        })
      })
    })
    this.labels.forEach((label) => {
      const id = label.element.dataset.sceneNodeId
      label.element.style.opacity = !query || (id && visibleNodeIds.has(id)) ? '1' : '0.18'
    })
  }

  private applyActiveNode(): void {
    if (!this.model) return
    const active = this.model.nodes.find((node) => node.id === this.activeNodeId)
    const eventSource = active?.kind === 'timeline-event' ? active.source as { eventType?: string; type?: string; data?: Record<string, unknown> } : null
    const cue = eventSource ? replayEventCue(eventSource) : undefined
    const compromisedTargetAssetId = cue?.kind === 'compromised'
      ? attackTargetAssetId(eventSource?.data ?? {}, true)
      : undefined
    const activeActor = active?.kind === 'timeline-event' ? active.actorRole : undefined
    const targetRole = active ? eventTargetRole(active, cue?.kind) : undefined
    const activeType = String(eventSource?.eventType ?? eventSource?.type ?? '')
    this.securityBarriers.forEach((group, index) => {
      const node = this.model?.nodes.find((item) => item.id === `security:barrier:${index + 1}`)
      const material = (group.userData.materials as MeshPhysicalMaterial[] | undefined)?.[0]
      if (!node || !material) return
      const themeFocused = !active || this.securityTheme.focusedLayers.includes(index + 1)
      const searchDimmed = Boolean(this.nodeQuery) && !this.model?.nodes.some((item) => item.kind === 'timeline-event' && JSON.stringify(item.source).toLocaleLowerCase().includes(this.nodeQuery))
      const opacity = themeFocused && !searchDimmed ? 0.58 : 0.14
      ;((group.userData.materials as MeshPhysicalMaterial[] | undefined) ?? []).forEach((item) => { item.opacity = opacity })
      group.userData.themeDimmed = !themeFocused
      if (activeType === 'defense.completed' && themeFocused) material.emissiveIntensity = 1.2
      else material.emissiveIntensity = 0.48
    })
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
        else state = 'scanning'
      }
      const internalTeamEvent = cue && (cue.kind === 'other' || cue.kind === 'session')
      if (internalTeamEvent && activeActor === 'attacker' && (node.id === 'network:jump:1' || node.id === 'network:jump:2')) state = 'scanning'
      if (internalTeamEvent && activeActor === 'defender' && (node.id === 'network:asset:1' || node.id === 'network:asset:2' || node.id === 'network:asset:3')) state = 'scanning'
      if (node.id === 'network:asset:1' && cue?.kind === 'probe') state = 'scanning'
      if (node.id === 'network:asset:1' && (cue?.kind === 'attack' || cue?.kind === 'exploit')) state = 'attacking'
      if (node.id === compromisedTargetAssetId) state = 'compromised'
      if (activeType === 'battle.created' && node.id === 'role:attacker') state = 'scanning'
      if (activeType === 'attack.started' && node.id === 'network:jump:1') state = 'attacking'
      if (activeType === 'attack.completed' && node.id === 'network:jump:2') state = 'attacking'
      if (activeType === 'battle.completed' && node.id === 'role:defender') state = 'scanning'
      if (selected && node.kind !== 'timeline-event') state = 'selected'
      if (node.kind === 'timeline-event' && selected && isExplicitlyCompromised(node)) state = 'compromised'
      group.scale.setScalar(selected && node.kind !== 'timeline-event' ? 1.06 : 1)
      setTopologyNodeState(group, state)
    }
    this.fiberGroups.forEach((group) => {
      const edge = group.userData.edge as { id: string; from: string; to: string; kind?: string }
      const participates = active?.kind === 'timeline-event'
        && (edge.id === this.targetFiberId || this.focusedFiberIds.has(edge.id) || edge.from === active.id || edge.to === active.id)
      const focused = active?.kind !== 'timeline-event' || participates
      const state = !focused ? 'idle' : cue?.kind === 'defense' ? 'defending' : cue?.kind === 'compromised' ? 'compromised'
        : cue?.kind === 'attack' || cue?.kind === 'exploit' ? 'attacking'
          : cue?.kind === 'probe' || cue?.kind === 'defense-request' ? 'scanning' : 'idle'
      setFiberState(group, state, focused, focused && edge.id === this.targetFiberId && this.playbackReversed)
    })
    this.updateAttackRouteProgress(this.playbackProgress)
    if (active?.kind === 'timeline-event') {
      if (activeType === 'defense.completed') this.startDefenseCompletionFlash()
      const targets: Array<{ id: string; compromised: boolean }> = []
      if (activeActor === 'attacker' || activeActor === 'defender') targets.push({ id: `role:${activeActor}`, compromised: false })
      if ((cue?.kind === 'defense-request' || cue?.kind === 'defense') && targetRole) targets.push({ id: `role:${targetRole}`, compromised: false })
      if (cue?.kind === 'probe' && (activeActor === 'attacker' || activeActor === 'defender')) targets.push({ id: `role:${activeActor}`, compromised: false })
      if (cue && (cue.kind === 'other' || cue.kind === 'session') && activeActor === 'attacker') {
        targets.push({ id: 'network:jump:1', compromised: false }, { id: 'network:jump:2', compromised: false })
      }
      if (cue && (cue.kind === 'other' || cue.kind === 'session') && activeActor === 'defender') {
        targets.push({ id: 'network:asset:1', compromised: false }, { id: 'network:asset:2', compromised: false }, { id: 'network:asset:3', compromised: false })
      }
      if (cue?.kind === 'compromised' && targetRole) targets.push({ id: `role:${targetRole}`, compromised: true })
      if (compromisedTargetAssetId) targets.push({ id: compromisedTargetAssetId, compromised: true })
      this.startIndicatorPulse(targets)
      if (cue?.kind === 'exploit' && targetRole) this.startImpactFlash(this.hardwareGroups.get('network:asset:2'))
    } else {
      cancelAnimationFrame(this.pulseFrame)
      this.pulseFrame = 0
      cancelAnimationFrame(this.impactFrame)
      this.impactFrame = 0
      this.barrierFeedback.cancel()
    }
    this.applySearchQuery()
  }

  private applyStatusBadges(): void {
    const statuses = eventStatusBadges(this.model, this.activeNodeId)
    this.statusBadges.forEach((badge, id) => {
      const state = statuses.get(id) ?? { state: 'normal' as const, text: '正常守护' }
      updateStatusBadge(badge.element, state.state, state.text)
    })
  }

  private showEventCue(node: AdminSceneNode): void {
    if (!this.scene) return
    const source = node.source as { eventType?: string; type?: string; data?: Record<string, unknown> }
    const cue = replayEventCue(source)
    const actorRole = cue.kind === 'defense-request' ? 'attacker' : cue.kind === 'defense' ? 'defender' : node.actorRole
    const actor = actorRole === 'attacker' || actorRole === 'defender' ? this.hardwareGroups.get(`role:${actorRole}`) : undefined
    const targetRole = eventTargetRole(node, cue.kind)
    const target = targetRole ? this.hardwareGroups.get(`role:${targetRole}`) : undefined
    const path = this.targetFiberId ? this.fiberCurves.get(this.targetFiberId) : undefined
    this.eventCue.show(this.scene, node, actor, target, path, this.playbackPaused)
  }

  private clearEventCue(): void {
    this.eventCue.clear(this.scene)
  }

  private startImpactFlash(group?: Group): void {
    const core = group?.userData.core as Mesh | undefined
    if (!core) return
    this.barrierFeedback.cancel()
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
      this.packetPlayer?.position(path, eased, target, this.playbackReversed)
      this.updatePlaybackFeedback(eased)
      this.render()
      if (this.playbackOutcome?.status === 'intercepted' && this.barrierFeedbackTriggered) {
        this.playbackProgress = this.playbackOutcome.triggerProgress
        this.playbackAnimationRequested = false
        this.playbackFrame = 0
        this.render()
        return
      }
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
    const selection = selectEventFiberRoute(node, this.model)
    this.playbackReversed = selection.reversed
    if (selection.routeId) {
      this.targetFiberId = selection.routeId
      return this.fiberCurves.get(selection.routeId)
    }
    const sideFlow = this.model?.edges.find((edge) => edge.id.startsWith('side-flow:'))
    if (!sideFlow || node?.kind !== 'timeline-event') {
      this.targetFiberId = undefined
      return undefined
    }
    const source = node.source as { eventType?: string; type?: string; data?: Record<string, unknown> } | null
    const cue = source ? replayEventCue(source) : undefined
    const actorRole = cue?.kind === 'defense-request' ? 'attacker' : cue?.kind === 'defense' ? 'defender' : node.actorRole
    const targetRole = eventTargetRole(node, cue?.kind)
    if ((actorRole !== 'attacker' && actorRole !== 'defender') || !targetRole || targetRole === actorRole) {
      this.targetFiberId = undefined
      return undefined
    }
    this.targetFiberId = sideFlow.id
    this.playbackReversed = actorRole === 'defender'
    return this.fiberCurves.get(sideFlow.id)
  }

  private focusNode(node: AdminSceneNode): void {
    if (!this.camera || !this.controls) return
    this.viewLockedNodeId = node.id
    this.controls.enabled = false
    const target = new Vector3(...node.position)
    const offset = this.camera.position.clone().sub(this.controls.target)
    if (offset.length() < 3.5) offset.set(0, 2.4, 4.2)
    this.controls.target.copy(target)
    this.camera.position.copy(target).add(offset)
    this.controls.update()
  }

  private handleContextMenu(event: MouseEvent): void {
    event.preventDefault()
    event.stopPropagation()
    this.unlockView()
  }

  private select(event: MouseEvent, onSelect?: (node: AdminSceneNode) => void): void {
    if (!this.renderer || !this.camera || !this.model || !onSelect) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hit = this.raycaster.intersectObjects([...this.hardwareGroups.values(), ...this.securityBarriers.values()], true)[0]
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

  private readonly onLabelClick = (event: MouseEvent): void => {
    if (!this.model || !this.onSelectNode) return
    const clickedElement = event.target instanceof HTMLElement
      ? event.target.closest<HTMLElement>('[data-scene-node-id]')
      : null
    const currentElement = event.currentTarget instanceof HTMLElement && event.currentTarget.matches('[data-scene-node-id]')
      ? event.currentTarget
      : null
    const target = clickedElement ?? currentElement
    const nodeId = target?.dataset.sceneNodeId
    if (!nodeId) return
    const node = this.model.nodes.find((item) => item.id === nodeId)
    if (!node) return
    event.preventDefault()
    event.stopPropagation()
    this.setActiveNode(node.id)
    this.focusNode(node)
    this.onSelectNode(node)
  }
}

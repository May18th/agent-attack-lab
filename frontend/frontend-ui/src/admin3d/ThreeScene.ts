import {
  AmbientLight, Color, CylinderGeometry, InstancedMesh, Matrix4, MeshBasicMaterial,
  PerspectiveCamera, Quaternion, Raycaster, Scene, SphereGeometry, Vector2, Vector3, WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { AdminSceneModel, AdminSceneNode } from './sceneModel'

export class WebGLUnavailableError extends Error {
  readonly code = 'WEBGL_UNAVAILABLE'
  constructor() { super('WEBGL_UNAVAILABLE: WebGL is not supported in this environment'); this.name = 'WebGLUnavailableError' }
}

export type ThreeSceneOptions = {
  onSelectNode?: (node: AdminSceneNode) => void
  rendererFactory?: () => WebGLRenderer
}

export class ThreeScene {
  private renderer?: WebGLRenderer
  private scene?: Scene
  private camera?: PerspectiveCamera
  private controls?: OrbitControls
  private frame = 0
  private paused = false
  private container?: HTMLElement
  private model?: AdminSceneModel
  private nodeMesh?: InstancedMesh
  private edgeMesh?: InstancedMesh
  private readonly raycaster = new Raycaster()
  private readonly pointer = new Vector2()
  private onClick?: (event: MouseEvent) => void
  private onResize?: () => void
  private sphereGeometry = new SphereGeometry(0.18, 12, 8)
  private edgeGeometry = new CylinderGeometry(0.025, 0.025, 1, 6)
  private nodeMaterial = new MeshBasicMaterial({ vertexColors: true })
  private edgeMaterial = new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7 })

  mount(container: HTMLElement, model: AdminSceneModel, options: ThreeSceneOptions = {}): void {
    this.dispose()
    this.sphereGeometry = new SphereGeometry(0.18, 12, 8)
    this.edgeGeometry = new CylinderGeometry(0.025, 0.025, 1, 6)
    this.nodeMaterial = new MeshBasicMaterial({ vertexColors: true })
    this.edgeMaterial = new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7 })
    this.container = container
    this.model = model
    try {
      this.renderer = options.rendererFactory ? options.rendererFactory() : new WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      this.container = undefined
      throw new WebGLUnavailableError()
    }
    const width = Math.max(1, container.clientWidth)
    const height = Math.max(1, container.clientHeight)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(width, height)
    this.renderer.domElement.setAttribute('aria-label', '3D 攻防态势场景')
    container.appendChild(this.renderer.domElement)
    this.scene = new Scene()
    this.scene.background = new Color('#101820')
    this.scene.add(new AmbientLight('#ffffff', 2))
    this.camera = new PerspectiveCamera(45, width / height, 0.1, 100)
    this.camera.position.set(0, 7, 11)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.set(0, 0, 0)
    this.controls.update()
    this.update(model)
    this.onResize = () => this.resize()
    window.addEventListener('resize', this.onResize)
    this.onClick = (event) => this.select(event, options.onSelectNode)
    this.renderer.domElement.addEventListener('click', this.onClick)
    this.animate()
  }

  update(model: AdminSceneModel): void {
    this.model = model
    if (!this.scene) return
    if (this.nodeMesh) { this.scene.remove(this.nodeMesh); this.nodeMesh.dispose() }
    if (this.edgeMesh) { this.scene.remove(this.edgeMesh); this.edgeMesh.dispose() }
    this.nodeMesh = new InstancedMesh(this.sphereGeometry, this.nodeMaterial, Math.max(1, model.nodes.length))
    const matrix = new Matrix4()
    model.nodes.forEach((node, index) => {
      matrix.makeTranslation(...node.position)
      this.nodeMesh!.setMatrixAt(index, matrix)
      this.nodeMesh!.setColorAt(index, new Color(node.color))
    })
    this.nodeMesh.instanceMatrix.needsUpdate = true
    this.nodeMesh.computeBoundingSphere()
    this.scene.add(this.nodeMesh)
    const edgeById = new Map(model.nodes.map(node => [node.id, node]))
    this.edgeMesh = new InstancedMesh(this.edgeGeometry, this.edgeMaterial, Math.max(1, model.edges.length))
    model.edges.forEach((edge, index) => {
      const from = edgeById.get(edge.from)?.position ?? [0, 0, 0]
      const to = edgeById.get(edge.to)?.position ?? [0, 0, 0]
      const start = new Vector3(...from)
      const end = new Vector3(...to)
      const direction = end.clone().sub(start)
      matrix.compose(start.add(end).multiplyScalar(0.5), new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.clone().normalize()), new Vector3(1, direction.length(), 1))
      this.edgeMesh!.setMatrixAt(index, matrix)
      this.edgeMesh!.setColorAt(index, new Color(edge.color))
    })
    this.edgeMesh.instanceMatrix.needsUpdate = true
    this.scene.add(this.edgeMesh)
  }

  setMotionPaused(paused: boolean): void { this.paused = paused }

  resetCamera(): void {
    if (!this.camera || !this.controls) return
    this.camera.position.set(0, 7, 11)
    this.controls.target.set(0, 0, 0)
    this.controls.update()
  }

  dispose(): void {
    cancelAnimationFrame(this.frame)
    if (this.onResize) window.removeEventListener('resize', this.onResize)
    if (this.renderer?.domElement && this.onClick) this.renderer.domElement.removeEventListener('click', this.onClick)
    this.nodeMesh?.dispose()
    this.edgeMesh?.dispose()
    this.sphereGeometry.dispose()
    this.edgeGeometry.dispose()
    this.nodeMaterial.dispose()
    this.edgeMaterial.dispose()
    this.controls?.dispose()
    this.renderer?.dispose()
    this.renderer?.domElement.remove()
    this.renderer = undefined
    this.scene = undefined
    this.camera = undefined
    this.controls = undefined
    this.container = undefined
    this.nodeMesh = undefined
    this.edgeMesh = undefined
    this.model = undefined
    this.onClick = undefined
    this.onResize = undefined
  }

  private animate = (): void => {
    if (!this.renderer || !this.scene || !this.camera) return
    this.frame = requestAnimationFrame(this.animate)
    if (!this.paused) this.controls?.update()
    this.renderer.render(this.scene, this.camera)
  }

  private resize(): void {
    if (!this.renderer || !this.camera || !this.container) return
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
  }

  private select(event: MouseEvent, onSelect?: (node: AdminSceneNode) => void): void {
    if (!this.renderer || !this.camera || !this.nodeMesh || !this.model || !onSelect) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hit = this.raycaster.intersectObject(this.nodeMesh)[0]
    if (hit?.instanceId !== undefined) onSelect(this.model.nodes[hit.instanceId])
  }
}


import { CatmullRomCurve3, Group, Scene, Vector3 } from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import { replayEventCue, type AdminSceneModel, type AdminSceneNode, type ReplayEventCueKind } from './sceneModel'

export type NodeBadgeState = 'normal' | 'probing' | 'attacked' | 'compromised' | 'controlled'
export type NodeBadge = { state: NodeBadgeState; text: string }

export function eventTargetRole(node: AdminSceneNode, kind?: ReplayEventCueKind): 'attacker' | 'defender' | undefined {
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

export function eventStatusBadges(model: AdminSceneModel | undefined, activeNodeId?: string): Map<string, NodeBadge> {
  const active = model?.nodes.find((node) => node.id === activeNodeId && node.kind === 'timeline-event')
  const source = active?.source as { eventType?: string; type?: string; data?: Record<string, unknown> } | null
  const cue = source ? replayEventCue(source) : undefined
  const targetRole = active ? eventTargetRole(active, cue?.kind) : undefined
  const statuses = new Map<string, NodeBadge>()
  for (const id of ['attacker', 'defender', 'network:asset:1', 'network:asset:2', 'network:asset:3']) {
    statuses.set(id.startsWith('network:') ? id : `role:${id}`, { state: 'normal', text: '正常守护' })
  }
  for (const id of ['network:jump:1', 'network:jump:2']) statuses.set(id, { state: 'controlled', text: '已受控' })
  if (!active || !cue) return statuses

  if (cue.kind === 'defense-request') statuses.set('role:defender', { state: 'probing', text: '防守检测中' })
  if (cue.kind === 'defense') {
    statuses.set('role:defender', { state: 'normal', text: '检测结果已回传' })
    statuses.set('role:attacker', { state: 'probing', text: '正在接收检测结果' })
  }
  if ((cue.kind === 'other' || cue.kind === 'session') && (active.actorRole === 'attacker' || active.actorRole === 'defender')) {
    const side = active.actorRole === 'attacker' ? '攻击方' : '防守方'
    statuses.set(`role:${active.actorRole}`, { state: 'probing', text: `${side}队内事件处理中` })
    const teammates = active.actorRole === 'attacker' ? ['network:jump:1', 'network:jump:2'] : ['network:asset:1', 'network:asset:2', 'network:asset:3']
    teammates.forEach((id) => statuses.set(id, { state: 'probing', text: `${side}队内协作中` }))
  }
  if (cue.kind === 'probe' && active.actorRole) statuses.set(`role:${active.actorRole}`, { state: 'probing', text: '正在探测' })
  if (targetRole && cue.kind === 'probe') statuses.set(`role:${targetRole}`, { state: 'probing', text: '正在被探测' })
  if (active.actorRole && (cue.kind === 'attack' || cue.kind === 'exploit')) statuses.set(`role:${active.actorRole}`, { state: 'attacked', text: '发起攻击' })
  if (targetRole && (cue.kind === 'attack' || cue.kind === 'exploit')) statuses.set(`role:${targetRole}`, { state: 'attacked', text: '遭受攻击' })
  if (targetRole && cue.kind === 'compromised') statuses.set(`role:${targetRole}`, { state: 'compromised', text: '已沦陷' })
  if (cue.kind === 'probe') statuses.set('network:asset:1', { state: 'probing', text: '正在被探测' })
  if (cue.kind === 'attack' || cue.kind === 'exploit') statuses.set('network:asset:1', { state: 'attacked', text: '遭受攻击' })
  if (cue.kind === 'compromised' && source?.data?.targetVerified === true) {
    const targetAssetId = source.data.targetAssetId
    const assetId = targetAssetId === 'network:asset:1' || targetAssetId === 'network:asset:2' || targetAssetId === 'network:asset:3'
      ? targetAssetId
      : 'network:asset:3'
    statuses.set(assetId, { state: 'compromised', text: '已沦陷' })
  }
  return statuses
}

export function updateStatusBadge(element: HTMLElement, state: NodeBadgeState, label: string): void {
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
  else if (state === 'probing') { add('circle', { cx: '6.5', cy: '6.5', r: '4' }); add('path', { d: 'M9.5 9.5 14 14' }) }
  else if (state === 'attacked') add('path', { d: 'M8 2 14 13H2L8 2Z M8 6v3 M8 11v.2' })
  element.className = `admin3d-node-status is-${state}`
  element.setAttribute('aria-label', label)
  element.replaceChildren(svg)
}

export class EventCuePlayer {
  label?: CSS2DObject
  remainingMs = 0
  frame = 0
  private lastFrame = 0
  private paused = true
  private scene?: Scene
  private readonly render: () => void

  constructor(render: () => void) {
    this.render = render
  }

  show(scene: Scene, node: AdminSceneNode, actor: Group | undefined, target: Group | undefined, path: CatmullRomCurve3 | undefined, paused: boolean): void {
    this.clear()
    this.scene = scene
    this.paused = paused
    const source = node.source as { eventType?: string; type?: string; data?: Record<string, unknown> }
    const cue = replayEventCue(source)
    const start = actor?.position.clone() ?? new Vector3(0, 0.72, 0)
    const end = target?.position.clone() ?? new Vector3(0, 0.72, 0)
    const element = document.createElement('div')
    element.className = `admin3d-event-cue cue-${cue.kind}`
    element.style.setProperty('--cue-color', cue.color)
    element.textContent = cue.label
    element.dataset.paused = String(paused)
    this.label = new CSS2DObject(element)
    this.label.position.copy(path ? path.getPointAt(0.5).add(new Vector3(0, 0.72, 0)) : target ? start.lerp(end, 0.5).add(new Vector3(0, 1.15, 0)) : start.add(new Vector3(0, 1.15, 0)))
    scene.add(this.label)
    this.remainingMs = 2500
    if (!paused) {
      this.lastFrame = performance.now()
      this.frame = requestAnimationFrame(this.advance)
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused
    if (paused) {
      cancelAnimationFrame(this.frame)
      this.frame = 0
      if (this.label) this.label.element.dataset.paused = 'true'
      return
    }
    if (this.label && this.remainingMs > 0) {
      this.label.element.dataset.paused = 'false'
      this.lastFrame = performance.now()
      this.frame = requestAnimationFrame(this.advance)
    }
  }

  clear(scene: Scene | undefined = this.scene): void {
    cancelAnimationFrame(this.frame)
    this.frame = 0
    if (this.label) { scene?.remove(this.label); this.label.element.remove(); this.label = undefined }
    this.remainingMs = 0
  }

  private advance = (now: number): void => {
    if (this.paused || !this.label) return
    this.remainingMs = Math.max(0, this.remainingMs - Math.max(0, now - this.lastFrame))
    this.lastFrame = now
    this.label.element.style.opacity = String(Math.min(1, this.remainingMs / 520))
    this.render()
    if (this.remainingMs > 0) this.frame = requestAnimationFrame(this.advance)
    else this.clear()
  }
}

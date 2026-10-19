import { describe, expect, it, vi } from 'vitest'
import { ConeGeometry, CylinderGeometry, Mesh, MeshPhysicalMaterial, OctahedronGeometry, TubeGeometry, Vector3 } from 'three'
import type { AdminBattleEvent } from '../adminApi'
import { getReplayBloomProfile, ThreeScene } from './ThreeScene'
import { buildAdminSceneModel, buildBattleTimelineSceneModel } from './sceneModel'

describe('ThreeScene', () => {
  it('renders abstract role nodes and energy-fiber links without physical equipment', () => {
    const scene = new ThreeScene()
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { value: 640 })
    Object.defineProperty(container, 'clientHeight', { value: 480 })
    const model = buildBattleTimelineSceneModel({
      id: 'b-1', topic: '主题测试', status: 'running', difficulty: 'mid', createdAt: '2026-10-19',
      attackerOut: { samples: [] }, defenderOut: [],
    }, [
      { sequence: 1, type: 'attack.probe.started', data: { agentRole: 'attacker', targetRole: 'defender' } },
      { sequence: 2, type: 'defense.rule.matched', data: { agentRole: 'defender' } },
    ])
    scene.mount(container, model, { rendererFactory: () => ({ setPixelRatio: vi.fn(), setSize: vi.fn(), render: vi.fn(), dispose: vi.fn(), domElement: document.createElement('canvas') }) as never })

    const internals = scene as unknown as { scene: import('three').Scene }
    const graph = internals.scene
    const attacker = graph.getObjectByName('node:role:attacker')
    const defender = graph.getObjectByName('node:role:defender')
    const core = graph.getObjectByName('energy-core:role:attacker') as Mesh
    const shell = graph.getObjectByName('carrier:role:attacker') as Mesh
    const scanWaves = graph.getObjectByName('scan-waves:role:attacker')
    const ring = graph.getObjectByName('selection-ring:role:attacker')
    const geometries: unknown[] = []
    const names: string[] = []
    graph.traverse((object) => {
      names.push(object.name)
      if (object instanceof Mesh) geometries.push(object.geometry)
    })

    expect(attacker).toBeDefined()
    expect(defender).toBeDefined()
    expect(core.material).toBeInstanceOf(MeshPhysicalMaterial)
    expect(core.geometry).toBeInstanceOf(OctahedronGeometry)
    expect((shell.material as MeshPhysicalMaterial).wireframe).toBe(true)
    expect(scanWaves?.children).toHaveLength(3)
    expect(ring).toBeDefined()
    expect(geometries.some((geometry) => geometry instanceof TubeGeometry)).toBe(true)
    expect(geometries.some((geometry) => geometry instanceof CylinderGeometry && geometry.parameters.radialSegments === 6)).toBe(true)
    expect(names.some((name) => /chassis|rack-|ethernet-port|rj45|monitor-|keyboard:|server-face/.test(name))).toBe(false)
    expect(names.some((name) => name.startsWith('fiber:'))).toBe(true)
    expect(names.some((name) => name.startsWith('fiber-arrow:'))).toBe(true)
    scene.setActiveNode('role:attacker')
    expect(container.querySelector('.admin3d-node-label--selected-device')?.textContent).toContain('未记录')
    scene.dispose()
  })

  it('renders high-DPI scenes at a sharper pixel ratio capped for performance', () => {
    const scene = new ThreeScene()
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { value: 640 })
    Object.defineProperty(container, 'clientHeight', { value: 480 })
    const originalPixelRatio = window.devicePixelRatio
    const setPixelRatio = vi.fn()
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2.75 })
    try {
      scene.mount(container, buildAdminSceneModel({ battles: [], metrics: {}, externalCases: [] }), {
        rendererFactory: () => ({ setPixelRatio, setSize: vi.fn(), render: vi.fn(), dispose: vi.fn(), domElement: document.createElement('canvas') }) as never,
      })

      expect(setPixelRatio).toHaveBeenCalledWith(2.5)
      scene.dispose()
    } finally {
      Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: originalPixelRatio })
    }
  })

  it('uses a tighter and softer bloom profile to keep topology edges crisp', () => {
    expect(getReplayBloomProfile(false)).toEqual({ strength: 0.4, radius: 0.32, threshold: 0.34 })
    expect(getReplayBloomProfile(true)).toEqual({ strength: 0.24, radius: 0.22, threshold: 0.34 })
  })

  it('renders event markers with only the current event cue label', () => {
    const scene = new ThreeScene()
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { value: 640 })
    Object.defineProperty(container, 'clientHeight', { value: 480 })
    const model = buildBattleTimelineSceneModel({
      id: 'battle-clean-path', topic: 'clean path', status: 'failed', difficulty: 'mid', createdAt: '2026-10-19',
      attackerOut: { samples: [] }, defenderOut: [],
    }, [
      { sequence: 1, type: 'attack.started', status: 'completed', data: { agentRole: 'attacker', targetRole: 'defender' } },
      { sequence: 2, type: 'battle.failed', status: 'failed' },
    ])
    scene.mount(container, model, { rendererFactory: () => ({ setPixelRatio: vi.fn(), setSize: vi.fn(), render: vi.fn(), dispose: vi.fn(), domElement: document.createElement('canvas') }) as never })
    const internals = scene as unknown as { scene: import('three').Scene; fiberGroups: Map<string, import('three').Group> }
    const events = model.nodes.filter((node) => node.kind === 'timeline-event')

    expect(events.every((node) => internals.scene.getObjectByName(`node:${node.id}`) === undefined)).toBe(true)
    expect(internals.fiberGroups.size).toBe(13)
    expect(container.querySelector('.admin3d-event-cue')).toBeNull()
    scene.setActiveNode(events[0].id)
    expect(container.querySelector('.admin3d-event-cue')?.textContent).toBe('发起攻击')
    scene.setActiveNode(events[1].id)
    expect(container.querySelector('.admin3d-event-cue')?.textContent).toBe('战局失败')
    expect(internals.fiberGroups.size).toBe(13)
    scene.dispose()
  })

  it('shows same-side agent activity inside the existing role nodes', () => {
    const scene = new ThreeScene()
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { value: 640 })
    Object.defineProperty(container, 'clientHeight', { value: 480 })
    const events: AdminBattleEvent[] = [
      { sequence: 1, type: 'agent.call.started', data: { agentRole: 'attacker', correlationId: 'attack-call' } },
      { sequence: 2, type: 'agent.call.completed', data: { agentRole: 'attacker', correlationId: 'attack-call' } },
      { sequence: 3, type: 'agent.call.started', data: { agentRole: 'defender', correlationId: 'defense-call' } },
      { sequence: 4, type: 'agent.call.completed', data: { agentRole: 'defender', correlationId: 'defense-call' } },
    ]
    const model = buildBattleTimelineSceneModel({
      id: 'battle-internal-flow', topic: 'internal flow', status: 'completed', difficulty: 'mid', createdAt: '2026-10-19',
      attackerOut: { samples: [] }, defenderOut: [],
    }, events)
    scene.mount(container, model, { rendererFactory: () => ({ setPixelRatio: vi.fn(), setSize: vi.fn(), render: vi.fn(), dispose: vi.fn(), domElement: document.createElement('canvas') }) as never })
    const internals = scene as unknown as { hardwareGroups: Map<string, import('three').Group>; fiberGroups: Map<string, import('three').Group>; statusBadges: Map<string, import('three/addons/renderers/CSS2DRenderer.js').CSS2DObject> }
    expect([...internals.hardwareGroups.keys()]).toEqual([
      'role:attacker', 'role:defender', 'network:jump:1', 'network:jump:2',
      'network:asset:1', 'network:asset:2', 'network:asset:3',
    ])
    expect(internals.fiberGroups.size).toBe(12)
    scene.setActiveNode(`event:battle-internal-flow:1:0`)
    expect(internals.hardwareGroups.get('role:attacker')?.userData.visualState).toBe('scanning')
    expect(internals.statusBadges.get('role:attacker')?.element.getAttribute('aria-label')).toContain('队内事件处理中')
    scene.setActiveNode(`event:battle-internal-flow:3:2`)
    expect(internals.hardwareGroups.get('role:defender')?.userData.visualState).toBe('scanning')
    expect(internals.statusBadges.get('role:defender')?.element.getAttribute('aria-label')).toContain('队内事件处理中')
    scene.dispose()
  })

  it('highlights same-team links and both existing nodes for internal events', () => {
    const scene = new ThreeScene()
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { value: 640 })
    Object.defineProperty(container, 'clientHeight', { value: 480 })
    const events: AdminBattleEvent[] = [
      { sequence: 1, type: 'agent.call.started', data: { agentRole: 'attacker' } },
      { sequence: 2, type: 'agent.call.started', data: { agentRole: 'defender' } },
    ]
    const model = buildBattleTimelineSceneModel({
      id: 'battle-team-links', topic: 'team links', status: 'completed', difficulty: 'mid', createdAt: '2026-10-19',
      attackerOut: { samples: [] }, defenderOut: [],
    }, events)
    scene.mount(container, model, { rendererFactory: () => ({ setPixelRatio: vi.fn(), setSize: vi.fn(), render: vi.fn(), dispose: vi.fn(), domElement: document.createElement('canvas') }) as never })
    const internals = scene as unknown as { hardwareGroups: Map<string, import('three').Group>; fiberGroups: Map<string, import('three').Group>; targetFiberId?: string }

    scene.setActiveNode('event:battle-team-links:1:0')
    expect(internals.targetFiberId).toBe('team-path:1')
    expect(internals.fiberGroups.get('team-path:1')?.userData.focused).toBe(true)
    expect(internals.hardwareGroups.get('network:jump:1')?.userData.visualState).toBe('scanning')
    expect(internals.hardwareGroups.get('network:jump:2')?.userData.visualState).toBe('scanning')

    scene.setActiveNode('event:battle-team-links:2:1')
    expect(internals.targetFiberId).toBe('team-path:2')
    expect(internals.fiberGroups.get('team-path:2')?.userData.focused).toBe(true)
    expect(internals.hardwareGroups.get('network:asset:1')?.userData.visualState).toBe('scanning')
    expect(internals.hardwareGroups.get('network:asset:2')?.userData.visualState).toBe('scanning')
    scene.dispose()
  })

  it('renders semantic labels without leaking battle titles into the scene labels', () => {
    const scene = new ThreeScene()
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { value: 640 })
    Object.defineProperty(container, 'clientHeight', { value: 480 })
    const model = buildAdminSceneModel({
      battles: [{ id: 'b-1', topic: '主题测试', status: 'running', difficulty: 'mid', createdAt: '2026-10-19', attackerOut: { samples: [] }, defenderOut: [] }],
      metrics: {}, externalCases: [],
    })
    scene.mount(container, model, { rendererFactory: () => ({ setPixelRatio: vi.fn(), setSize: vi.fn(), render: vi.fn(), dispose: vi.fn(), domElement: document.createElement('canvas') }) as never })

    expect(container.textContent).toContain('攻击方')
    expect(container.textContent).not.toContain('主题测试')
    scene.dispose()
  })

  it('mounts, updates, highlights, resets camera, and disposes cleanly', () => {
    const scene = new ThreeScene()
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { value: 640 })
    Object.defineProperty(container, 'clientHeight', { value: 480 })
    const model = buildAdminSceneModel({ battles: [], metrics: {}, externalCases: [] })
    expect(() => scene.mount(container, model, { rendererFactory: () => ({ setPixelRatio: vi.fn(), setSize: vi.fn(), render: vi.fn(), dispose: vi.fn(), domElement: document.createElement('canvas') }) as never })).not.toThrow()
    expect(() => scene.update(model)).not.toThrow()
    expect(() => scene.setActiveNode('event:battle-1:1:0')).not.toThrow()
    expect(() => scene.resetCamera()).not.toThrow()
    expect(() => scene.dispose()).not.toThrow()
    expect(container.childElementCount).toBe(0)
  })

  it('routes attack packets to an explicitly named target and stops the burst at event completion', () => {
    const callbacks: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    try {
      const scene = new ThreeScene()
      const container = document.createElement('div')
      Object.defineProperty(container, 'clientWidth', { value: 640 })
      Object.defineProperty(container, 'clientHeight', { value: 480 })
      const model = buildBattleTimelineSceneModel({
        id: 'battle-packets', topic: 'packets', status: 'completed', difficulty: 'high', createdAt: '2026-10-19',
        attackerOut: { samples: [] }, defenderOut: [],
      }, [
        { sequence: 1, type: 'attack.compromised', status: 'completed', data: { agentRole: 'attacker', targetRole: 'defender', description: '入侵成功' } },
        { sequence: 2, type: 'defense.rule.matched', status: 'completed', data: { agentRole: 'defender' } },
      ])
      scene.mount(container, model, {
        rendererFactory: () => ({ setPixelRatio: vi.fn(), setSize: vi.fn(), render: vi.fn(), dispose: vi.fn(), domElement: document.createElement('canvas') }) as never,
      })
      const eventNode = model.nodes.find((node) => node.kind === 'timeline-event')!
      scene.setActiveNode(eventNode.id, true)
      const internals = scene as unknown as { scene: import('three').Scene; playbackMarker: import('three').Group }
      const packets = internals.playbackMarker.children.filter((child) => child.name.startsWith('replay-packet-unit-'))
      const defenderWaves = internals.scene.getObjectByName('scan-waves:role:defender')!
      const firstWave = defenderWaves.children[0]
      const initialWaveScale = firstWave.scale.x
      const packetFrame = callbacks.at(-1)!

      const eventEdge = model.edges.find((edge) => edge.id === (scene as unknown as { targetFiberId: string }).targetFiberId)!
      expect(eventEdge.kind).toBe('network')
      expect(internals.scene.getObjectByName(`fiber:${eventEdge.id}`)).toBeDefined()
      expect(internals.scene.getObjectByName(`fiber-direction:${eventEdge.id}`)?.children.some((child) => child instanceof Mesh && child.geometry instanceof ConeGeometry)).toBe(true)
      expect(packets.filter((packet) => packet.visible)).toHaveLength(6)
      expect(defenderWaves.visible).toBe(true)
      callbacks[1](performance.now() + 500)
      expect(firstWave.scale.x).not.toBe(initialWaveScale)
      packetFrame(performance.now() + 2600)
      expect(internals.playbackMarker.visible).toBe(false)
      scene.dispose()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('pauses an event packet in place and resumes only its remaining animation time', () => {
    const frames: FrameRequestCallback[] = []
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000)
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.push(callback); return frames.length }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    try {
      const scene = new ThreeScene()
      const container = document.createElement('div')
      Object.defineProperty(container, 'clientWidth', { value: 640 })
      Object.defineProperty(container, 'clientHeight', { value: 480 })
      const model = buildBattleTimelineSceneModel({
        id: 'battle-pause', topic: 'pause', status: 'completed', difficulty: 'low', createdAt: '2026-10-19',
        attackerOut: { samples: [] }, defenderOut: [],
      }, [
        { sequence: 1, type: 'attack.started', data: { agentRole: 'attacker', targetRole: 'defender' } },
        { sequence: 2, type: 'defense.rule.matched', data: { agentRole: 'defender' } },
      ])
      scene.mount(container, model, { rendererFactory: () => ({ setPixelRatio: vi.fn(), setSize: vi.fn(), render: vi.fn(), dispose: vi.fn(), domElement: document.createElement('canvas') }) as never })
      scene.setPlaybackPaused(false)
      scene.setActiveNode(model.nodes.find((node) => node.kind === 'timeline-event')!.id, true)
      const internals = scene as unknown as { playbackMarker: import('three').Group; playbackFrame: number }
      const marker = internals.playbackMarker
      frames.at(-1)!(2000)
      clock.mockReturnValue(2000)
      scene.setPlaybackPaused(true)
      const pausedFrameCount = frames.length
      clock.mockReturnValue(7000)
      scene.setPlaybackPaused(false)

      expect(frames.length).toBeGreaterThan(pausedFrameCount)
      frames[internals.playbackFrame - 1]!(8499)
      expect(marker.visible).toBe(true)
      frames[internals.playbackFrame - 1]!(8500)
      expect(marker.visible).toBe(false)
      scene.dispose()
    } finally {
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    }
  })

  it('shows a semantic event cue and keeps it visible while replay is paused', () => {
    const scene = new ThreeScene()
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { value: 640 })
    Object.defineProperty(container, 'clientHeight', { value: 480 })
    const model = buildBattleTimelineSceneModel({
      id: 'battle-cue', topic: 'cue', status: 'completed', difficulty: 'low', createdAt: '2026-10-19', attackerOut: { samples: [] }, defenderOut: [],
    }, [{ sequence: 1, type: 'attack.probe.started', status: 'completed', data: { agentRole: 'attacker', targetRole: 'defender' } }])
    scene.mount(container, model, { rendererFactory: () => ({ setPixelRatio: vi.fn(), setSize: vi.fn(), render: vi.fn(), dispose: vi.fn(), domElement: document.createElement('canvas') }) as never })
    const eventNode = model.nodes.find((node) => node.kind === 'timeline-event')!

    scene.setPlaybackPaused(true)
    scene.setActiveNode(eventNode.id)

    const cue = container.querySelector('.admin3d-event-cue')
    expect(cue?.textContent).toBe('扫描探测')
    expect(cue?.getAttribute('data-paused')).toBe('true')
    scene.dispose()
  })

  it('fades the event cue after the configured duration of unpaused playback', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.push(callback); return frames.length }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    try {
      const scene = new ThreeScene()
      const container = document.createElement('div')
      Object.defineProperty(container, 'clientWidth', { value: 640 })
      Object.defineProperty(container, 'clientHeight', { value: 480 })
      const model = buildBattleTimelineSceneModel({
        id: 'battle-cue-fade', topic: 'cue', status: 'completed', difficulty: 'low', createdAt: '2026-10-19', attackerOut: { samples: [] }, defenderOut: [],
      }, [{ sequence: 1, type: 'attack.started', status: 'completed', data: { agentRole: 'attacker', targetRole: 'defender' } }])
      scene.mount(container, model, { rendererFactory: () => ({ setPixelRatio: vi.fn(), setSize: vi.fn(), render: vi.fn(), dispose: vi.fn(), domElement: document.createElement('canvas') }) as never })
      scene.setPlaybackPaused(false)
      const eventNode = model.nodes.find((node) => node.kind === 'timeline-event')!
      scene.setActiveNode(eventNode.id)
      frames.at(-1)!(performance.now() + 2600)

      expect(container.querySelector('.admin3d-event-cue')).toBeNull()
      scene.dispose()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('dims unrelated fibers while the active event interaction remains emphasized', () => {
    const scene = new ThreeScene()
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { value: 640 })
    Object.defineProperty(container, 'clientHeight', { value: 480 })
    const model = buildBattleTimelineSceneModel({
      id: 'battle-focus', topic: 'focus', status: 'completed', difficulty: 'low', createdAt: '2026-10-19', attackerOut: { samples: [] }, defenderOut: [],
    }, [
      { sequence: 1, type: 'attack.probe.started', status: 'completed', data: { agentRole: 'attacker', targetRole: 'defender' } },
      { sequence: 2, type: 'defense.rule.matched', status: 'completed', data: { agentRole: 'defender' } },
      { sequence: 3, type: 'defense.report.completed', status: 'completed', data: { agentRole: 'defender' } },
    ])
    scene.mount(container, model, { rendererFactory: () => ({ setPixelRatio: vi.fn(), setSize: vi.fn(), render: vi.fn(), dispose: vi.fn(), domElement: document.createElement('canvas') }) as never })
    const active = model.nodes.find((node) => node.kind === 'timeline-event')!
    scene.setActiveNode(active.id)
    const internals = scene as unknown as { fiberGroups: Map<string, import('three').Group> }

    expect(internals.fiberGroups.get('network-path:1')?.userData.focused).toBe(true)
    expect(internals.fiberGroups.has(`actor-link:${active.id}`)).toBe(false)
    expect([...internals.fiberGroups.entries()].filter(([id]) => id !== 'network-path:1').every(([, fiber]) => fiber.userData.focused === false)).toBe(true)
    scene.dispose()
  })

  it('renders the existing attack jumps and defender network assets without moving them', () => {
    const scene = new ThreeScene()
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { value: 640 })
    Object.defineProperty(container, 'clientHeight', { value: 480 })
    const model = buildBattleTimelineSceneModel({
      id: 'battle-network-path', topic: 'network path', status: 'completed', difficulty: 'mid', createdAt: '2026-10-19',
      attackerOut: { samples: [] }, defenderOut: [],
    }, [{ sequence: 1, type: 'attack.started', status: 'completed', data: { agentRole: 'attacker', targetRole: 'defender' } }])
    scene.mount(container, model, { rendererFactory: () => ({ setPixelRatio: vi.fn(), setSize: vi.fn(), render: vi.fn(), dispose: vi.fn(), domElement: document.createElement('canvas') }) as never })

    const internals = scene as unknown as { hardwareGroups: Map<string, import('three').Group>; fiberGroups: Map<string, import('three').Group>; statusBadges: Map<string, import('three/addons/renderers/CSS2DRenderer.js').CSS2DObject> }
    expect([...internals.hardwareGroups.keys()]).toEqual([
      'role:attacker', 'role:defender', 'network:jump:1', 'network:jump:2',
      'network:asset:1', 'network:asset:2', 'network:asset:3',
    ])
    expect([...internals.fiberGroups.keys()].filter((id) => id.startsWith('network-path:'))).toEqual(Array.from({ length: 9 }, (_, index) => `network-path:${index + 1}`))
    expect(internals.hardwareGroups.get('network:jump:1')?.position.toArray()).toEqual([-2.8, 0.15, -1.4])
    expect(internals.hardwareGroups.get('network:asset:2')?.position.toArray()).toEqual([2.8, 0.15, 0])
    expect(container.querySelectorAll('.admin3d-node-label--attack-jump strong')).toHaveLength(2)
    expect(container.querySelectorAll('.admin3d-node-label--defender-asset strong')).toHaveLength(3)
    scene.dispose()
  })

  it('focuses the event relationships recorded in the replay model', () => {
    const scene = new ThreeScene()
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { value: 640 })
    Object.defineProperty(container, 'clientHeight', { value: 480 })
    const model = buildBattleTimelineSceneModel({
      id: 'battle-routes', topic: 'routes', status: 'completed', difficulty: 'mid', createdAt: '2026-10-19', attackerOut: { samples: [] }, defenderOut: [],
    }, [
      { sequence: 1, type: 'attack.started', status: 'completed', data: { agentRole: 'attacker', targetRole: 'defender' } },
      { sequence: 2, type: 'attack.started', status: 'completed', data: { agentRole: 'attacker', targetRole: 'defender' } },
    ])
    scene.mount(container, model, { rendererFactory: () => ({ setPixelRatio: vi.fn(), setSize: vi.fn(), render: vi.fn(), dispose: vi.fn(), domElement: document.createElement('canvas') }) as never })
    const events = model.nodes.filter((node) => node.kind === 'timeline-event')
    const internals = scene as unknown as { fiberGroups: Map<string, import('three').Group> }

    scene.setActiveNode(events[0].id)
    expect(internals.fiberGroups.get('network-path:3')?.userData.focused).toBe(true)
    scene.setActiveNode(events[1].id)
    expect(internals.fiberGroups.get('network-path:6')?.userData.focused).toBe(true)
    scene.dispose()
  })

  it('sends each sample to defense, then returns that round result along the same path', () => {
    const scene = new ThreeScene()
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { value: 640 })
    Object.defineProperty(container, 'clientHeight', { value: 480 })
    const events: AdminBattleEvent[] = []
    for (const round of [1, 2, 3]) {
      events.push({ sequence: round * 2 - 1, type: 'round.started', data: { round } })
      events.push({ sequence: round * 2, type: 'round.completed', data: { round, caught: [], risks: [], fixed: [] } })
    }
    const model = buildBattleTimelineSceneModel({
      id: 'battle-three-rounds', topic: '三轮攻防', status: 'completed', difficulty: 'high', createdAt: '2026-10-19',
      attackerOut: { samples: [] }, defenderOut: [],
    }, events)
    scene.mount(container, model, {
      rendererFactory: () => ({ setPixelRatio: vi.fn(), setSize: vi.fn(), render: vi.fn(), dispose: vi.fn(), domElement: document.createElement('canvas') }) as never,
    })
    const internals = scene as unknown as {
      fiberGroups: Map<string, import('three').Group>
      playbackReversed: boolean
      targetFiberId: string
    }
    const timelineEvents = model.nodes.filter((node) => node.kind === 'timeline-event')
    const firstRequest = timelineEvents[0]
    const firstResponse = timelineEvents[1]
    scene.setActiveNode(firstRequest.id, true)
    const firstRequestEdge = model.edges.find((edge) => edge.id === internals.targetFiberId)!
    expect(firstRequestEdge).toBeDefined()
    expect(firstRequestEdge.id).toBe('network-path:3')
    expect(internals.playbackReversed).toBe(false)
    scene.setActiveNode(firstResponse.id, true)
    const firstResponseEdge = model.edges.find((edge) => edge.id === internals.targetFiberId)!
    expect(firstResponseEdge).toBeDefined()
    expect(firstResponseEdge.id).toBe(firstRequestEdge.id)
    expect(internals.playbackReversed).toBe(true)

    const secondResponse = timelineEvents[3]
    scene.setActiveNode(secondResponse.id, true)
    const secondResponseEdge = model.edges.find((edge) => edge.id === internals.targetFiberId)!
    expect(secondResponseEdge).toBeDefined()
    expect(secondResponseEdge.id).toBe('network-path:6')
    expect(internals.playbackReversed).toBe(true)
    expect(events.filter((event) => event.type === 'round.completed')).toHaveLength(3)
    scene.dispose()
  })

  it('keeps a low-rate ambient breathing loop for resting nodes', () => {
    let nextFrame!: FrameRequestCallback
    const requestFrame = vi.fn((callback: FrameRequestCallback) => { nextFrame = callback; return requestFrame.mock.calls.length })
    vi.stubGlobal('requestAnimationFrame', requestFrame)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    try {
      const scene = new ThreeScene()
      const container = document.createElement('div')
      Object.defineProperty(container, 'clientWidth', { value: 640 })
      Object.defineProperty(container, 'clientHeight', { value: 480 })
      scene.mount(container, buildAdminSceneModel({ battles: [], metrics: {}, externalCases: [] }), {
        rendererFactory: () => ({ setPixelRatio: vi.fn(), setSize: vi.fn(), render: vi.fn(), dispose: vi.fn(), domElement: document.createElement('canvas') }) as never,
      })

      expect(requestFrame).toHaveBeenCalledOnce()
      nextFrame(performance.now() + 60)
      expect(requestFrame).toHaveBeenCalledTimes(2)
      scene.dispose()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('schedules frames only while the playback marker is moving', () => {
    const frames: FrameRequestCallback[] = []
    const requestFrame = vi.fn((callback: FrameRequestCallback) => { frames.push(callback); return frames.length })
    vi.stubGlobal('requestAnimationFrame', requestFrame)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    try {
      const scene = new ThreeScene()
      const container = document.createElement('div')
      Object.defineProperty(container, 'clientWidth', { value: 640 })
      Object.defineProperty(container, 'clientHeight', { value: 480 })
      const model = buildBattleTimelineSceneModel({
        id: 'battle-motion', topic: 'motion', status: 'completed', difficulty: 'low', createdAt: '2026-10-19',
        attackerOut: { samples: [] }, defenderOut: [],
      }, [
        { sequence: 1, type: 'attack.started', data: { agentRole: 'attacker', targetRole: 'defender' } },
        { sequence: 2, type: 'defense.rule.matched', data: { agentRole: 'defender' } },
      ])
      scene.mount(container, model, {
        rendererFactory: () => ({ setPixelRatio: vi.fn(), setSize: vi.fn(), render: vi.fn(), dispose: vi.fn(), domElement: document.createElement('canvas') }) as never,
      })
      const event = model.nodes.find((node) => node.kind === 'timeline-event')!
      scene.setActiveNode(event.id, true)
      expect(requestFrame).toHaveBeenCalledTimes(3)
      frames[2]!(performance.now() + 600)
      expect(requestFrame).toHaveBeenCalledTimes(4)
      frames[3]!(performance.now() + 2600)
      expect((scene as unknown as { playbackMarker: import('three').Group }).playbackMarker.visible).toBe(false)
      scene.dispose()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('shows the current event cue without drawing a separate event label', () => {
    const scene = new ThreeScene()
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { value: 640 })
    Object.defineProperty(container, 'clientHeight', { value: 480 })
    const model = buildBattleTimelineSceneModel({
      id: 'battle-label', topic: 'label', status: 'completed', difficulty: 'low', createdAt: '2026-10-19',
      attackerOut: { samples: [] }, defenderOut: [],
    }, [{ sequence: 1, type: 'attack.sample.generated' }])
    scene.mount(container, model, {
      rendererFactory: () => ({ setPixelRatio: vi.fn(), setSize: vi.fn(), render: vi.fn(), dispose: vi.fn(), domElement: document.createElement('canvas') }) as never,
    })
    const eventNode = model.nodes.find((node) => node.kind === 'timeline-event')!
    scene.setActiveNode(eventNode.id)

    expect(container.querySelectorAll('.admin3d-event-cue')).toHaveLength(1)
    expect(container.querySelector('.admin3d-node-label--event')).toBeNull()
    scene.dispose()
    expect(container.querySelectorAll('.admin3d-event-cue')).toHaveLength(0)
  })

  it('reports WebGL unavailability with a recognizable error', () => {
    const scene = new ThreeScene()
    const container = document.createElement('div')
    try {
      scene.mount(container, buildAdminSceneModel({ battles: [], metrics: {}, externalCases: [] }))
      throw new Error('expected WebGL initialization to fail')
    } catch (error) {
      expect(error).toMatchObject({ code: 'WEBGL_UNAVAILABLE' })
    }
  })

  it('raycasts an abstract role carrier and displays its device status tooltip', () => {
    const scene = new ThreeScene()
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { value: 640 })
    Object.defineProperty(container, 'clientHeight', { value: 480 })
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 640, bottom: 480, width: 640, height: 480, toJSON: () => ({}),
    })
    const onSelectNode = vi.fn()
    const model = buildBattleTimelineSceneModel({
      id: 'battle-device-raycast', topic: 'device raycast', status: 'running', difficulty: 'low', createdAt: '2026-10-19',
      attackerOut: { samples: [] }, defenderOut: [],
    }, [{ sequence: 1, type: 'attack.started' }])
    scene.mount(container, model, {
      onSelectNode,
      rendererFactory: () => ({ setPixelRatio: vi.fn(), setSize: vi.fn(), render: vi.fn(), dispose: vi.fn(), domElement: canvas }) as never,
    })
    const camera = (scene as unknown as { camera: import('three').PerspectiveCamera }).camera
    const attacker = (scene as unknown as { hardwareGroups: Map<string, import('three').Group> }).hardwareGroups.get('role:attacker')!
    const target = new Vector3()
    attacker.getObjectByName('carrier:role:attacker')!.getWorldPosition(target)
    target.project(camera)
    canvas.dispatchEvent(new MouseEvent('click', {
      clientX: ((target.x + 1) / 2) * 640,
      clientY: ((1 - target.y) / 2) * 480,
    }))

    expect(onSelectNode).toHaveBeenCalledWith(expect.objectContaining({ id: 'role:attacker', kind: 'attacker' }))
    expect(container.querySelector('.admin3d-node-label--selected-device')?.textContent).toContain('攻击方节点')
    scene.dispose()
  })

  it('disables real-time shadows when the scene exceeds the dense-scene threshold', () => {
    const scene = new ThreeScene()
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { value: 640 })
    Object.defineProperty(container, 'clientHeight', { value: 480 })
    const shadowMap = { enabled: true }
    const model = buildBattleTimelineSceneModel({
      id: 'battle-dense', topic: 'dense', status: 'running', difficulty: 'mid', createdAt: '2026-10-19',
      attackerOut: { samples: [] }, defenderOut: [],
    }, Array.from({ length: 25 }, (_, index) => ({ sequence: index + 1, type: 'attack.sample.generated' })))
    scene.mount(container, model, {
      rendererFactory: () => ({ setPixelRatio: vi.fn(), setSize: vi.fn(), render: vi.fn(), dispose: vi.fn(), domElement: document.createElement('canvas'), shadowMap }) as never,
    })

    expect(shadowMap.enabled).toBe(false)
    scene.dispose()
  })
})

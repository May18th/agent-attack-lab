import { describe, expect, it, vi } from 'vitest'
import { ThreeScene } from './ThreeScene'
import { buildAdminSceneModel, buildBattleTimelineSceneModel } from './sceneModel'

describe('ThreeScene', () => {
  it('mounts, updates, pauses, resets camera, and disposes cleanly', () => {
    const scene = new ThreeScene()
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { value: 640 })
    Object.defineProperty(container, 'clientHeight', { value: 480 })
    const model = buildAdminSceneModel({ battles: [], metrics: {}, externalCases: [] })
    expect(() => scene.mount(container, model, { rendererFactory: () => ({ setPixelRatio: vi.fn(), setSize: vi.fn(), render: vi.fn(), dispose: vi.fn(), domElement: document.createElement('canvas') }) as never })).not.toThrow()
    expect(() => scene.update(model)).not.toThrow()
    expect(() => scene.setMotionPaused(true)).not.toThrow()
    expect(() => scene.resetCamera()).not.toThrow()
    expect(() => scene.dispose()).not.toThrow()
    expect(container.childElementCount).toBe(0)
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

  it('raycasts a 3D timeline event node and returns its source event', () => {
    const scene = new ThreeScene()
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { value: 640 })
    Object.defineProperty(container, 'clientHeight', { value: 480 })
    const canvas = document.createElement('canvas')
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 640, bottom: 480, width: 640, height: 480, toJSON: () => ({}),
    })
    const event = { sequence: 1, type: '启动' }
    const onSelectNode = vi.fn()
    const model = buildBattleTimelineSceneModel({
      id: 'battle-raycast', topic: 'raycast', status: 'running', difficulty: 'low', createdAt: '2026-10-19',
      attackerOut: { samples: [] }, defenderOut: [],
    }, [event])
    scene.mount(container, model, {
      onSelectNode,
      rendererFactory: () => ({
        setPixelRatio: vi.fn(), setSize: vi.fn(), render: vi.fn(), dispose: vi.fn(), domElement: canvas,
      }) as never,
    })

    canvas.dispatchEvent(new MouseEvent('click', { clientX: 320, clientY: 240 }))

    expect(onSelectNode).toHaveBeenCalledWith(expect.objectContaining({ kind: 'timeline-event', source: event }))
    scene.dispose()
  })
})

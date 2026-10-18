import { describe, expect, it, vi } from 'vitest'
import { ThreeScene } from './ThreeScene'
import { buildAdminSceneModel } from './sceneModel'

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
})

import { describe, expect, it, vi } from 'vitest'
import { BoxGeometry, Scene } from 'three'
import { createSecurityBarriers, applySecurityTheme, BarrierFeedbackPlayer } from './BarrierRenderer'
import type { AdminSceneModel, AdminSceneNode } from './sceneModel'

const node = (id: string, position: [number, number, number], kind: AdminSceneNode['kind']): AdminSceneNode => ({
  id, position, kind, label: id, status: 'running', color: '#ffffff', source: null,
})

const model: AdminSceneModel = {
  nodes: [
    node('network:jump:2', [-3, 0.15, 0], 'attack-jump'),
    node('security:barrier:1', [-2, 0.15, 0], 'security-barrier'),
    node('security:barrier:2', [-1, 0.15, 0], 'security-barrier'),
    node('security:barrier:3', [0, 0.15, 0], 'security-barrier'),
    node('security:barrier:4', [1, 0.15, 0], 'security-barrier'),
    node('network:asset:2', [2, 0.15, 0], 'defender-asset'),
  ],
  edges: [], statusColors: { pending: '', running: '', completed: '', failed: '', unknown: '' },
}

describe('BarrierRenderer', () => {
  it('creates four independently selectable barrier groups and labels', () => {
    const scene = new Scene()
    const barriers = createSecurityBarriers(scene, model)

    expect([...barriers.groups.values()].map((group) => group.userData.sceneNodeId)).toEqual([
      'security:barrier:1', 'security:barrier:2', 'security:barrier:3', 'security:barrier:4',
    ])
    expect([...barriers.labels.values()].map((label) => label.element.textContent)).toEqual([
      '1清洗', '2推理', '3管控', '4审计',
    ])
    expect([...barriers.labels.values()].map((label) => label.element.title)).toEqual([
      '第 1 层：输入标准化清洗', '第 2 层：推理引导', '第 3 层：工具动作管控', '第 4 层：审计监测恢复',
    ])
    expect([...barriers.labels.values()].every((label) => label.element.classList.contains('admin3d-security-barrier-label--readable'))).toBe(true)
    expect(scene.getObjectByName('security-barrier:3')).toBe(barriers.groups.get(2))
    expect(new Set([...barriers.labels.values()].map((label) => label.position.y)).size).toBe(1)
    for (const group of barriers.groups.values()) {
      const wall = group.getObjectByName('security-barrier-wall')
      expect(wall).toBeDefined()
      const wallSize = (wall as import('three').Mesh).geometry as BoxGeometry
      expect(wallSize.parameters.width).toBeGreaterThanOrEqual(0.3)
      expect(wallSize.parameters.height).toBeGreaterThanOrEqual(1.7)
    }
  })

  it('dims non-focused layers without changing their identifying color', () => {
    const barriers = createSecurityBarriers(new Scene(), model)
    applySecurityTheme(barriers, { name: 'SQL 注入', focusedLayers: [1, 3] })

    const opacity = (index: number) => {
      const group = barriers.groups.get(index)
      if (!group) throw new Error(`missing barrier ${index}`)
      return (group.userData.materials as Array<{ opacity: number }>)[0].opacity
    }
    expect([0, 1, 2, 3].map(opacity)).toEqual([0.64, 0.14, 0.64, 0.14])
    expect(barriers.labels.get(1)?.element.dataset.focused).toBe('false')
  })

  it('owns barrier feedback animation and its statistics label', () => {
    const scene = new Scene()
    const barriers = createSecurityBarriers(scene, model)
    const feedback = new BarrierFeedbackPlayer(() => {})
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(41)

    feedback.pulse(scene, barriers, { name: '通用', focusedLayers: [1, 2, 3, 4] }, 1, 'intercepted', 2, 5)

    expect(barriers.stats.get(1)?.element.textContent).toBe('第 2 层拦截 2/5')
    expect(barriers.groups.get(1)?.getObjectByName('security-barrier-pulse:2')?.visible).toBe(true)
    const secondBarrier = barriers.groups.get(1)!
    expect((secondBarrier.getObjectByName('security-impact-burst') as import('three').Group).visible).toBe(true)
    const pulseMaterial = (secondBarrier.getObjectByName('security-barrier-pulse:2') as import('three').Mesh).material as import('three').MeshPhysicalMaterial
    expect(pulseMaterial.color.getHexString()).toBe('36c98e')
    expect(feedback.frame).toBe(41)
    feedback.cancel()
    frame.mockRestore()
  })

  it('marks missing persisted interception statistics as unrecorded', () => {
    const scene = new Scene()
    const barriers = createSecurityBarriers(scene, model)
    const feedback = new BarrierFeedbackPlayer(() => {})
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(41)

    feedback.pulse(scene, barriers, { name: '通用', focusedLayers: [1, 2, 3, 4] }, 1, 'intercepted', undefined, undefined)

    expect(barriers.stats.get(1)?.element.textContent).toBe('第 2 层拦截 未记录')
    feedback.cancel()
    frame.mockRestore()
  })

  it('uses orange for the unverified penetration pulse', () => {
    const scene = new Scene()
    const barriers = createSecurityBarriers(scene, model)
    const feedback = new BarrierFeedbackPlayer(() => {})
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(41)

    feedback.pulse(scene, barriers, { name: '通用', focusedLayers: [1, 2, 3, 4] }, 1, 'penetrated')

    const pulse = barriers.groups.get(1)?.getObjectByName('security-barrier-pulse:2') as import('three').Mesh
    expect((pulse.material as import('three').MeshPhysicalMaterial).color.getHexString()).toBe('f39c12')
    feedback.cancel()
    frame.mockRestore()
  })

  it('shakes the barrier wall on impact and restores its authored position', () => {
    const barriers = createSecurityBarriers(new Scene(), model)
    const group = barriers.groups.get(1)!
    const initial = group.position.clone()
    const feedback = new BarrierFeedbackPlayer(() => {})
    vi.spyOn(performance, 'now').mockReturnValue(1000)
    let animate: FrameRequestCallback | undefined
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      animate = callback
      return 41
    })

    feedback.pulse(undefined, barriers, { name: '通用', focusedLayers: [1, 2, 3, 4] }, 1, 'intercepted')
    animate?.(1200)
    expect(group.position.equals(initial)).toBe(false)
    animate?.(1780)
    expect(group.position.equals(initial)).toBe(true)
    feedback.cancel()
    frame.mockRestore()
    vi.restoreAllMocks()
  })
})

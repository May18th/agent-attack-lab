import { cleanup, render, screen, waitFor } from '@testing-library/react'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BattleScene from './BattleScene'
import type { Battle } from './api'

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>()
  return { ...actual, WebGLRenderer: vi.fn() }
})

const battle: Battle = {
  id: 'battle-42',
  difficulty: 'mid',
  topic: 'API topic',
  status: 'running',
  createdAt: '2026-10-25T00:00:00Z',
  attackerOut: { samples: [{ type: 'case', severity: 'mid', content: 'sample' }] },
  defenderOut: [],
}

let originalUserAgentDescriptor: PropertyDescriptor | undefined
function setBrowserUserAgent() {
  originalUserAgentDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'userAgent')
  Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 Chrome/140' })
}

function installResizeObserver() {
  const observer = { observe: vi.fn(), disconnect: vi.fn() }
  vi.stubGlobal('ResizeObserver', class TestResizeObserver {
    observe = observer.observe
    disconnect = observer.disconnect
  })
  return observer
}

function createRenderer(setSize: () => void = () => undefined) {
  const renderer = {
    domElement: document.createElement('canvas'),
    setPixelRatio: vi.fn(),
    setClearColor: vi.fn(),
    setSize: vi.fn(function mockedSetSize() { return setSize() }),
    render: vi.fn(),
    dispose: vi.fn(),
    outputColorSpace: THREE.SRGBColorSpace,
  }
  vi.mocked(THREE.WebGLRenderer).mockImplementation(function MockWebGLRenderer() {
    return renderer as unknown as THREE.WebGLRenderer
  })
  return renderer
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  if (originalUserAgentDescriptor) Object.defineProperty(window.navigator, 'userAgent', originalUserAgentDescriptor)
  else Reflect.deleteProperty(window.navigator, 'userAgent')
  originalUserAgentDescriptor = undefined
  vi.clearAllMocks()
})

describe('BattleScene', () => {
  it('renders a neutral preview with only battle data that the API provides', () => {
    const view = render(<BattleScene battle={battle} />)
    const host = view.container.querySelector('.battle-scene')

    expect(host).toBeInTheDocument()
    expect(host).toHaveAttribute('aria-label', '战场场景预览')
    expect(screen.getByText('场景预览')).toBeInTheDocument()
    expect(screen.getByText('1 个样本')).toBeInTheDocument()
    expect(screen.getByText('running')).toBeInTheDocument()
    expect(view.container).not.toHaveTextContent(/L0\s*-\s*L3 ACTIVE|ARBITER CORE/)
  })

  it('falls back in jsdom without creating a canvas or animation frame', async () => {
    const frame = vi.fn(() => 1)
    vi.stubGlobal('requestAnimationFrame', frame)
    const view = render(<BattleScene battle={null} />)
    const host = view.container.querySelector('.battle-scene')

    await waitFor(() => expect(host).toHaveAttribute('data-webgl', 'unavailable'))
    expect(screen.getByRole('status')).toHaveTextContent('3D 场景不可用，仍可查看战局数据。')
    expect(host?.querySelector('canvas')).not.toBeInTheDocument()
    expect(frame).not.toHaveBeenCalled()
  })

  it('falls back and releases resources when WebGLRenderer construction fails', async () => {
    setBrowserUserAgent()
    installResizeObserver()
    const rendererError = new Error('WebGL unavailable')
    vi.mocked(THREE.WebGLRenderer).mockImplementation(function MockWebGLRenderer() { throw rendererError })
    const frame = vi.fn(() => 1)
    vi.stubGlobal('requestAnimationFrame', frame)
    const view = render(<BattleScene battle={battle} />)
    const host = view.container.querySelector('.battle-scene')

    await waitFor(() => expect(host).toHaveAttribute('data-webgl', 'unavailable'))
    expect(screen.getByRole('status')).toBeVisible()
    expect(THREE.WebGLRenderer).toHaveBeenCalledTimes(1)
    expect(host?.querySelector('canvas')).not.toBeInTheDocument()
    expect(frame).not.toHaveBeenCalled()
  })

  it('cleans up a partially initialized renderer when sizing fails', async () => {
    setBrowserUserAgent()
    const observer = installResizeObserver()
    const renderer = createRenderer(() => { throw new Error('resize failed') })
    const frame = vi.fn(() => 1)
    vi.stubGlobal('requestAnimationFrame', frame)
    const view = render(<BattleScene battle={battle} />)
    const host = view.container.querySelector('.battle-scene')

    await waitFor(() => expect(host).toHaveAttribute('data-webgl', 'unavailable'))
    expect(screen.getByRole('status')).toBeVisible()
    expect(observer.disconnect).toHaveBeenCalled()
    expect(renderer.dispose).toHaveBeenCalled()
    expect(host?.querySelector('canvas')).not.toBeInTheDocument()
    expect(frame).not.toHaveBeenCalled()
  })

  it('releases the renderer, observer, canvas, and animation frame on unmount', async () => {
    setBrowserUserAgent()
    const observer = installResizeObserver()
    const renderer = createRenderer()
    const frame = vi.fn(() => 7)
    const cancelFrame = vi.fn()
    const disposeGeometry = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose')
    const disposeMaterial = vi.spyOn(THREE.Material.prototype, 'dispose')
    vi.stubGlobal('requestAnimationFrame', frame)
    vi.stubGlobal('cancelAnimationFrame', cancelFrame)
    const view = render(<BattleScene battle={battle} />)
    const host = view.container.querySelector('.battle-scene')

    await waitFor(() => expect(host).toHaveAttribute('data-webgl', 'available'))
    expect(host?.querySelector('canvas')).toBe(renderer.domElement)

    view.unmount()

    expect(cancelFrame).toHaveBeenCalledWith(7)
    expect(observer.disconnect).toHaveBeenCalled()
    expect(renderer.dispose).toHaveBeenCalled()
    expect(disposeGeometry).toHaveBeenCalled()
    expect(disposeMaterial).toHaveBeenCalled()
    expect(host?.querySelector('canvas')).not.toBeInTheDocument()
  })

  it('falls back without leaking a renderer when ResizeObserver is unavailable', async () => {
    setBrowserUserAgent()
    vi.stubGlobal('ResizeObserver', undefined)
    const renderer = createRenderer()
    const frame = vi.fn(() => 1)
    vi.stubGlobal('requestAnimationFrame', frame)
    const view = render(<BattleScene battle={battle} />)
    const host = view.container.querySelector('.battle-scene')

    await waitFor(() => expect(host).toHaveAttribute('data-webgl', 'unavailable'))
    expect(screen.getByRole('status')).toBeVisible()
    expect(renderer.dispose).toHaveBeenCalled()
    expect(host?.querySelector('canvas')).not.toBeInTheDocument()
    expect(frame).not.toHaveBeenCalled()
  })
})

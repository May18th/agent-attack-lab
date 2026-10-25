import { useEffect, useRef } from 'react'
import type { BufferGeometry, Material } from 'three'
import type { Battle } from './api'

export default function BattleScene({ battle }: { battle: Battle | null }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let disposed = false
    let disposeScene: (() => void) | undefined
    const showFallback = () => {
      if (!disposed) host.dataset.webgl = 'unavailable'
    }

    const initialize = async () => {
      if (navigator.userAgent.includes('jsdom')) {
        showFallback()
        return
      }

      let renderer: import('three').WebGLRenderer | undefined
      let observer: ResizeObserver | undefined
      let scene: import('three').Scene | undefined
      let frameId: number | null = null
      let canvasAttached = false

      const release = () => {
        if (frameId !== null) cancelAnimationFrame(frameId)
        observer?.disconnect()
        scene?.traverse((object) => {
          const resourceObject = object as typeof object & { geometry?: BufferGeometry; material?: Material | Material[] }
          resourceObject.geometry?.dispose()
          if (resourceObject.material) {
            const materials = Array.isArray(resourceObject.material) ? resourceObject.material : [resourceObject.material]
            materials.forEach((material) => material.dispose())
          }
        })
        renderer?.dispose()
        if (canvasAttached) renderer?.domElement.remove()
      }

      try {
        const three = await import('three')
        if (disposed) return

        scene = new three.Scene()
        scene.background = new three.Color(0x07101f)
        scene.fog = new three.FogExp2(0x07101f, 0.045)
        const camera = new three.PerspectiveCamera(42, 1, 0.1, 100)
        camera.position.set(0, 2.4, 10)

        renderer = new three.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
        renderer.setClearColor(0x07101f, 1)
        renderer.outputColorSpace = three.SRGBColorSpace
        host.appendChild(renderer.domElement)
        canvasAttached = true

        const world = new three.Group()
        world.rotation.x = -0.08
        scene.add(world)

        const center = new three.Mesh(
          new three.IcosahedronGeometry(0.68, 2),
          new three.MeshStandardMaterial({ color: 0x42bfff, emissive: 0x07527a, emissiveIntensity: 1.1, roughness: 0.28, metalness: 0.25 }),
        )
        world.add(center)

        const shells: import('three').Mesh[] = []
        ;[1.35, 2.05, 2.8].forEach((radius, index) => {
          const shell = new three.Mesh(
            new three.IcosahedronGeometry(radius, 1),
            new three.MeshBasicMaterial({
              color: [0x3ce0ff, 0x4ba9ff, 0x837cff][index],
              wireframe: true,
              transparent: true,
              opacity: 0.17 - index * 0.025,
            }),
          )
          shell.rotation.z = index * 0.3
          shells.push(shell)
          world.add(shell)
        })

        const roleGeometry = new three.OctahedronGeometry(0.45, 0)
        const attacker = new three.Mesh(roleGeometry, new three.MeshStandardMaterial({ color: 0xff6380, emissive: 0x70152a, emissiveIntensity: 0.8 }))
        const defender = new three.Mesh(roleGeometry, new three.MeshStandardMaterial({ color: 0x45cfff, emissive: 0x075272, emissiveIntensity: 0.8 }))
        attacker.position.set(-4, 0.1, 0)
        defender.position.set(4, 0.1, 0)
        world.add(attacker, defender)

        const path = new three.BufferGeometry().setFromPoints([
          attacker.position,
          new three.Vector3(-0.8, 0, 0),
          new three.Vector3(0.8, 0, 0),
          defender.position,
        ])
        world.add(new three.Line(path, new three.LineBasicMaterial({ color: 0x4aaad1, transparent: true, opacity: 0.42 })))

        const starGeometry = new three.BufferGeometry()
        const positions = new Float32Array(240 * 3)
        for (let index = 0; index < positions.length; index += 3) {
          const radius = 5 + Math.random() * 10
          const angle = Math.random() * Math.PI * 2
          positions[index] = Math.cos(angle) * radius
          positions[index + 1] = (Math.random() - 0.5) * 8
          positions[index + 2] = Math.sin(angle) * radius - 3
        }
        starGeometry.setAttribute('position', new three.BufferAttribute(positions, 3))
        scene.add(new three.Points(starGeometry, new three.PointsMaterial({ color: 0x83c8ef, size: 0.025, transparent: true, opacity: 0.5 })))

        scene.add(new three.AmbientLight(0x9ac9ff, 1.0))
        const keyLight = new three.PointLight(0xff6380, 14, 18)
        keyLight.position.set(-4, 2, 4)
        const fillLight = new three.PointLight(0x45cfff, 16, 18)
        fillLight.position.set(4, 2, 4)
        scene.add(keyLight, fillLight)

        const resize = () => {
          if (!renderer) return
          const width = Math.max(1, host.clientWidth)
          const height = Math.max(1, host.clientHeight)
          renderer.setSize(width, height, false)
          camera.aspect = width / height
          camera.updateProjectionMatrix()
        }

        if (typeof ResizeObserver === 'undefined') throw new Error('ResizeObserver unavailable')
        observer = new ResizeObserver(resize)
        observer.observe(host)
        resize()

        const clock = new three.Clock()
        const animate = () => {
          if (disposed || !renderer) return
          const time = clock.getElapsedTime()
          center.rotation.y = time * 0.38
          center.scale.setScalar(1 + Math.sin(time * 2) * 0.025)
          shells.forEach((shell, index) => {
            shell.rotation.y = time * (index % 2 ? -0.08 : 0.1) + index
            shell.rotation.x = Math.sin(time * 0.18 + index) * 0.13
          })
          attacker.rotation.y = time * 0.4
          defender.rotation.y = -time * 0.4
          renderer.render(scene!, camera)
          frameId = requestAnimationFrame(animate)
        }

        frameId = requestAnimationFrame(animate)
        disposeScene = release
        host.dataset.webgl = 'available'
      } catch {
        release()
        showFallback()
      }
    }

    void initialize()
    return () => {
      disposed = true
      disposeScene?.()
    }
  }, [])

  return <div className="battle-scene" ref={hostRef} aria-label="战场场景预览">
    <div className="scene-vignette" />
    <div className="scene-label attacker-label"><b>攻击数据</b><span>{battle ? `${battle.attackerOut.samples.length} 个样本` : '等待数据'}</span></div>
    <div className="scene-label defender-label"><b>战局编号</b><span>{battle?.id ?? '等待数据'}</span></div>
    <div className="core-label"><span>场景预览</span><b>{battle?.status ?? '等待数据'}</b></div>
    <div className="webgl-fallback" role="status">3D 场景不可用，仍可查看战局数据。</div>
  </div>
}

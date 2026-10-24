import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { Battle } from './api'

type Props = { battle: Battle | null }

export default function BattleScene({ battle }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    if (navigator.userAgent.includes('jsdom')) {
      host.dataset.webgl = 'unavailable'
      return
    }

    const scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(0x030713, 0.055)
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100)
    camera.position.set(0, 2.7, 11)

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' })
    } catch {
      host.dataset.webgl = 'unavailable'
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    renderer.setClearColor(0x030713, 1)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    host.appendChild(renderer.domElement)

    const world = new THREE.Group()
    world.rotation.x = -0.08
    scene.add(world)

    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.62, 3),
      new THREE.MeshStandardMaterial({ color: 0x59d9ff, emissive: 0x0a72ad, emissiveIntensity: 1.5, roughness: 0.18, metalness: 0.32 }),
    )
    world.add(core)

    const shells: THREE.Mesh[] = []
    ;[1.25, 1.78, 2.35, 2.95].forEach((radius, index) => {
      const shell = new THREE.Mesh(
        new THREE.IcosahedronGeometry(radius, 2),
        new THREE.MeshBasicMaterial({
          color: [0x3ce0ff, 0x4ba9ff, 0x6f7cff, 0x9a6fff][index],
          wireframe: true,
          transparent: true,
          opacity: 0.16 - index * 0.018,
        }),
      )
      shell.rotation.z = index * 0.34
      shells.push(shell)
      world.add(shell)
    })

    const sideGeometry = new THREE.IcosahedronGeometry(0.48, 1)
    const attacker = new THREE.Mesh(sideGeometry, new THREE.MeshStandardMaterial({ color: 0xff4f78, emissive: 0xa90e36, emissiveIntensity: 1.2 }))
    const defender = new THREE.Mesh(sideGeometry, new THREE.MeshStandardMaterial({ color: 0x31c8ff, emissive: 0x086b9c, emissiveIntensity: 1.2 }))
    attacker.position.set(-4.25, 0.3, 0)
    defender.position.set(4.25, 0.3, 0)
    world.add(attacker, defender)

    const beamMaterial = new THREE.LineBasicMaterial({ color: battle ? 0xff5d83 : 0x3a6583, transparent: true, opacity: battle ? 0.68 : 0.24 })
    const beam = new THREE.Line(new THREE.BufferGeometry().setFromPoints([attacker.position, new THREE.Vector3(-0.7, 0, 0)]), beamMaterial)
    world.add(beam)

    const starGeometry = new THREE.BufferGeometry()
    const starPositions = new Float32Array(420 * 3)
    for (let index = 0; index < starPositions.length; index += 3) {
      const radius = 5 + Math.random() * 11
      const angle = Math.random() * Math.PI * 2
      starPositions[index] = Math.cos(angle) * radius
      starPositions[index + 1] = (Math.random() - 0.5) * 9
      starPositions[index + 2] = Math.sin(angle) * radius - 3
    }
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
    const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0x7acbff, size: 0.025, transparent: true, opacity: 0.5 }))
    scene.add(stars)

    scene.add(new THREE.AmbientLight(0x8fbfff, 0.8))
    const key = new THREE.PointLight(0xff4f78, 20, 20)
    key.position.set(-4, 2, 4)
    const fill = new THREE.PointLight(0x31c8ff, 24, 20)
    fill.position.set(4, 2, 4)
    scene.add(key, fill)

    const resize = () => {
      const width = Math.max(1, host.clientWidth)
      const height = Math.max(1, host.clientHeight)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()

    let frame = 0
    const clock = new THREE.Clock()
    const animate = () => {
      const time = clock.getElapsedTime()
      core.rotation.y = time * 0.42
      core.scale.setScalar(1 + Math.sin(time * 2.2) * 0.035)
      shells.forEach((shell, index) => {
        shell.rotation.y = time * (index % 2 ? -0.08 : 0.1) + index
        shell.rotation.x = Math.sin(time * 0.18 + index) * 0.15
      })
      attacker.rotation.y = time * 0.5
      defender.rotation.y = -time * 0.5
      stars.rotation.y = time * 0.008
      renderer.render(scene, camera)
      frame = requestAnimationFrame(animate)
    }
    animate()

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line) {
          object.geometry.dispose()
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          materials.forEach((material) => material.dispose())
        }
      })
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [battle])

  return <div className="battle-scene" ref={hostRef} aria-label="三维攻防战场">
    <div className="scene-vignette" />
    <div className="scene-label attacker-label"><b>ATTACKER</b><span>{battle?.attackerOut.samples.length ?? 0} PAYLOADS</span></div>
    <div className="scene-label defender-label"><b>DEFENDER</b><span>{battle ? 'L0 - L3 ACTIVE' : 'STANDBY'}</span></div>
    <div className="core-label"><span>ARBITER CORE</span><b>{battle ? battle.status.toUpperCase() : 'WAITING'}</b></div>
    <div className="webgl-fallback">当前浏览器无法启动 3D 战场，业务功能仍可正常使用。</div>
  </div>
}

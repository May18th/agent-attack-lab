import { useEffect, useRef } from 'react'
import {
  ACESFilmicToneMapping, AmbientLight, BufferGeometry, Color, DirectionalLight,
  Float32BufferAttribute, Group, HemisphereLight, Mesh, MeshBasicMaterial,
  MeshPhysicalMaterial, MeshStandardMaterial, PerspectiveCamera, PointLight, Points, PointsMaterial,
  Scene, SphereGeometry, TorusGeometry, Vector2,
  WebGLRenderer,
} from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

type AuthSolarPlanet = {
  label: string
  x: number
  y: number
  z: number
  radius: number
  color: string
  ring?: boolean
  speed: number
}

export const AUTH_SOLAR_LAYOUT = {
  core: { x: -0.9, y: 0.2, z: 0 },
  orbits: [1.55, 2.25, 3.05, 3.8],
  planets: [
    { label: '侦测', x: -2.55, y: 0.44, z: 0.18, radius: 0.26, color: '#6ee7ff', speed: 0.08 },
    { label: '防守', x: 1.75, y: -0.14, z: 0.35, radius: 0.34, color: '#55e8c7', ring: true, speed: 0.06 },
    { label: '审计', x: -3.12, y: -0.56, z: -0.12, radius: 0.21, color: '#a78bfa', speed: 0.05 },
    { label: '规则', x: -0.25, y: 1.46, z: -0.3, radius: 0.16, color: '#b9f5ff', ring: true, speed: 0.1 },
    { label: '回放', x: 2.65, y: 0.72, z: -0.46, radius: 0.19, color: '#8b9cff', speed: 0.075 },
  ] satisfies AuthSolarPlanet[],
} as const

function disposeScene(root: Scene): void {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<MeshPhysicalMaterial | MeshStandardMaterial | MeshBasicMaterial | PointsMaterial>()
  root.traverse((object) => {
    if ('geometry' in object && object.geometry instanceof BufferGeometry) geometries.add(object.geometry)
    if ('material' in object) {
      const list = Array.isArray(object.material) ? object.material : [object.material]
      list.forEach((material) => {
        if (material instanceof MeshPhysicalMaterial || material instanceof MeshStandardMaterial || material instanceof MeshBasicMaterial || material instanceof PointsMaterial) materials.add(material)
      })
    }
  })
  geometries.forEach((geometry) => geometry.dispose())
  materials.forEach((material) => material.dispose())
}

function createRockGeometry(radius: number, color: string, seed: number): SphereGeometry {
  const geometry = new SphereGeometry(radius, 40, 28)
  const base = new Color(color)
  const positions = geometry.getAttribute('position')
  const colors = new Float32Array(positions.count * 3)
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index)
    const y = positions.getY(index)
    const z = positions.getZ(index)
    const noise = Math.sin(x * 8.7 + seed * 1.7) * 0.5 + Math.sin(y * 13.1 - seed) * 0.28 + Math.sin(z * 17.4 + x * 3.2) * 0.22
    const shade = Math.max(-0.16, Math.min(0.16, noise * 0.1))
    const vertex = base.clone().offsetHSL(0, shade * 0.25, shade)
    colors[index * 3] = vertex.r
    colors[index * 3 + 1] = vertex.g
    colors[index * 3 + 2] = vertex.b
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  return geometry
}

function createParticles(): Points {
  const count = 320
  const positions = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    const angle = index * 2.399963
    const radius = 4.2 + ((index * 41) % 100) / 15
    positions[index * 3] = Math.cos(angle) * radius
    positions[index * 3 + 1] = ((index * 17) % 100) / 24 - 1.5
    positions[index * 3 + 2] = Math.sin(angle) * radius - 0.5
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  const material = new PointsMaterial({ color: '#8fdfff', size: 0.012, transparent: true, opacity: 0.22, depthWrite: false, sizeAttenuation: true })
  const points = new Points(geometry, material)
  points.name = 'auth-solar-particles'
  return points
}

function addOrbit(parent: Group, radius: number, rotation: [number, number, number], color: string, opacity: number): Mesh {
  const orbit = new Mesh(new TorusGeometry(radius, 0.012, 6, 180), new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }))
  orbit.rotation.set(...rotation)
  orbit.name = `auth-orbit:${radius}`
  parent.add(orbit)
  return orbit
}

function addPlanet(parent: Group, planet: AuthSolarPlanet, index: number): Group {
  const group = new Group()
  group.position.set(planet.x, planet.y, planet.z)
  group.userData.speed = planet.speed
  const material = new MeshStandardMaterial({
    color: '#ffffff',
    vertexColors: true,
    emissive: new Color(planet.color).multiplyScalar(0.16),
    emissiveIntensity: 0.24,
    metalness: 0.03,
    roughness: 0.7,
  })
  const planetMesh = new Mesh(createRockGeometry(planet.radius, planet.color, index + 1), material)
  planetMesh.name = `auth-planet:${planet.label}`
  group.add(planetMesh)
  const aura = new Mesh(new SphereGeometry(planet.radius * 1.28, 20, 16), new MeshBasicMaterial({ color: planet.color, transparent: true, opacity: 0.035, depthWrite: false }))
  group.add(aura)
  if (planet.ring) {
    const ring = new Mesh(new TorusGeometry(planet.radius * 1.65, 0.01, 6, 64), new MeshBasicMaterial({ color: planet.color, transparent: true, opacity: 0.46, depthWrite: false }))
    ring.rotation.x = Math.PI * 0.58
    ring.rotation.z = Math.PI * 0.18
    group.add(ring)
  }
  parent.add(group)
  return group
}

export function AuthSolarScene() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' })
    } catch {
      container.classList.add('auth-solar-scene--fallback')
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.toneMapping = ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.08
    renderer.domElement.setAttribute('aria-hidden', 'true')
    container.prepend(renderer.domElement)

    const scene = new Scene()
    const camera = new PerspectiveCamera(32, 1, 0.1, 80)
    camera.position.set(0.12, 2.2, 11.8)
    camera.lookAt(-0.6, 0.1, 0)
    scene.add(new AmbientLight('#b7e6ff', 0.42))
    scene.add(new HemisphereLight('#d7f4ff', '#081a35', 0.82))
    const keyLight = new DirectionalLight('#9cecff', 2.8)
    keyLight.position.set(-4, 6, 4)
    scene.add(keyLight)
    const pointLight = new PointLight('#4ddcff', 9, 18, 1.8)
    pointLight.position.set(-0.9, 0.4, 1.8)
    scene.add(pointLight)
    scene.add(createParticles())

    const system = new Group()
    system.name = 'auth-solar-system'
    system.position.set(-0.22, -0.1, 0)
    system.scale.setScalar(0.84)
    scene.add(system)
    const orbitStage = new Group()
    orbitStage.position.set(AUTH_SOLAR_LAYOUT.core.x, AUTH_SOLAR_LAYOUT.core.y, AUTH_SOLAR_LAYOUT.core.z)
    system.add(orbitStage)
    const orbitRings = AUTH_SOLAR_LAYOUT.orbits.map((radius, index) => addOrbit(orbitStage, radius, [Math.PI * 0.5 + (index % 2) * 0.16, index * 0.22, index % 2 ? -0.14 : 0.12], index % 2 ? '#a78bfa' : '#62e9ff', 0.12 - index * 0.018))

    const star = new Group()
    star.name = 'auth-solar-core'
    const coreMaterial = new MeshStandardMaterial({ color: '#ffffff', vertexColors: true, emissive: '#0b5261', emissiveIntensity: 0.28, metalness: 0.06, roughness: 0.58 })
    const core = new Mesh(createRockGeometry(0.88, '#2f76d8', 9), coreMaterial)
    star.add(core)
    star.add(new Mesh(new SphereGeometry(1.1, 48, 32), new MeshBasicMaterial({ color: '#22d3ee', transparent: true, opacity: 0.035, depthWrite: false })))
    const coreRing = new Mesh(new TorusGeometry(1.16, 0.018, 8, 96), new MeshBasicMaterial({ color: '#93f5ff', transparent: true, opacity: 0.42, depthWrite: false }))
    coreRing.rotation.set(Math.PI * 0.48, Math.PI * 0.16, 0.2)
    star.add(coreRing)
    const coreRingTwo = new Mesh(new TorusGeometry(1.32, 0.008, 6, 120), new MeshBasicMaterial({ color: '#a78bfa', transparent: true, opacity: 0.26, depthWrite: false }))
    coreRingTwo.rotation.set(Math.PI * 0.62, -0.14, 0.48)
    star.add(coreRingTwo)
    orbitStage.add(star)
    const planets = AUTH_SOLAR_LAYOUT.planets.map((planet) => {
      const group = addPlanet(orbitStage, planet, index)
      group.userData.baseY = planet.y
      return group
    })
    const composer = new EffectComposer(renderer)
    const bloom = new UnrealBloomPass(new Vector2(1, 1), 0.16, 0.34, 0.62)
    composer.addPass(new RenderPass(scene, camera))
    composer.addPass(bloom)
    composer.addPass(new OutputPass())

    const pointer = new Vector2(-10, -10)
    const targetTilt = new Vector2()
    let raf = 0
    let running = true
    let last = performance.now()
    const resize = () => {
      const rect = container.getBoundingClientRect()
      const width = Math.max(1, rect.width)
      const height = Math.max(1, rect.height)
      const aspect = width / height
      camera.aspect = aspect
      camera.position.z = aspect < 1.1 ? 14.6 : 11.8
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
      composer.setSize(width, height)
      bloom.resolution.set(width, height)
    }
    const onPointerMove = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect()
      pointer.set((event.clientX - rect.left) / Math.max(rect.width, 1), (event.clientY - rect.top) / Math.max(rect.height, 1))
      targetTilt.set((pointer.y - 0.5) * 0.08, (pointer.x - 0.5) * 0.12)
    }
    const render = (now: number) => {
      if (!running) return
      const delta = Math.min(0.05, (now - last) / 1000)
      last = now
      if (!reduceMotion) {
        orbitStage.rotation.y += delta * 0.052
        orbitStage.rotation.x = Math.sin(now * 0.00016) * 0.022
        orbitRings.forEach((ring, index) => { ring.rotation.z += delta * (index % 2 ? -0.08 : 0.055) })
        planets.forEach((planet, index) => { planet.rotation.y += delta * (0.28 + index * 0.04); planet.position.y = Number(planet.userData.baseY) + Math.sin(now * 0.0008 + index) * 0.018 })
        core.rotation.y += delta * 0.18
        coreRing.rotation.z += delta * 0.12
        coreRingTwo.rotation.z -= delta * 0.08
        system.rotation.x += (targetTilt.x - system.rotation.x) * 0.035
        system.rotation.y += (targetTilt.y - system.rotation.y) * 0.035
      }
      composer.render()
      raf = window.requestAnimationFrame(render)
    }
    const handleVisibility = () => {
      running = !document.hidden
      if (running && !raf) { last = performance.now(); raf = window.requestAnimationFrame(render) }
      if (!running && raf) { window.cancelAnimationFrame(raf); raf = 0 }
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)
    container.addEventListener('pointermove', onPointerMove, { passive: true })
    document.addEventListener('visibilitychange', handleVisibility)
    resize()
    raf = window.requestAnimationFrame(render)
    return () => {
      running = false
      window.cancelAnimationFrame(raf)
      resizeObserver.disconnect()
      container.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('visibilitychange', handleVisibility)
      disposeScene(scene)
      composer.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  return <div ref={containerRef} className="auth-solar-scene" role="img" aria-label="智能体攻防三维星体中枢" />
}

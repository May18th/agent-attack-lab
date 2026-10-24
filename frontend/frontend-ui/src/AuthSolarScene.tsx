import { useEffect, useRef } from 'react'
import {
  ACESFilmicToneMapping, AmbientLight, BufferGeometry, Color, DirectionalLight,
  Float32BufferAttribute, FogExp2, Group, HemisphereLight, Line, LineBasicMaterial, Mesh, MeshBasicMaterial,
  MeshPhysicalMaterial, MeshStandardMaterial, PerspectiveCamera, PointLight,
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
  orbitIndex: number
}

export const AUTH_SOLAR_LAYOUT = {
  core: { x: -0.9, y: 0.2, z: 0 },
  orbits: [1.55, 2.25, 3.05, 3.8],
  planets: [
    { label: '侦测', x: -2.55, y: 0.44, z: 0.18, radius: 0.26, color: '#78b7c1', speed: 0.08, orbitIndex: 0 },
    { label: '防守', x: 1.75, y: -0.14, z: 0.35, radius: 0.34, color: '#7fb8a8', ring: true, speed: 0.06, orbitIndex: 1 },
    { label: '审计', x: -3.12, y: -0.56, z: -0.12, radius: 0.21, color: '#827cae', speed: 0.05, orbitIndex: 2 },
    { label: '规则', x: -0.25, y: 1.46, z: -0.3, radius: 0.16, color: '#abc5c2', speed: 0.1, orbitIndex: 0 },
    { label: '回放', x: 2.65, y: 0.72, z: -0.46, radius: 0.19, color: '#7887b8', speed: 0.075, orbitIndex: 3 },
  ] satisfies AuthSolarPlanet[],
} as const

export const AUTH_SOLAR_ORBIT_PROFILES = [
  { scale: [1.18, 0.82] as [number, number], rotation: [0, 0, 0.12] as [number, number, number], color: '#5d9fa8', opacity: 0.14, offset: [0.06, -0.04, 0] as [number, number, number] },
  { scale: [0.92, 1.12] as [number, number], rotation: [0, 0, -0.14] as [number, number, number], color: '#817ba7', opacity: 0.12, offset: [-0.08, 0.02, -0.04] as [number, number, number] },
  { scale: [1.28, 0.74] as [number, number], rotation: [0, 0, 0.12] as [number, number, number], color: '#5d9fa8', opacity: 0.1, offset: [0.1, 0.06, 0.04] as [number, number, number] },
  { scale: [0.84, 1.16] as [number, number], rotation: [0, 0, -0.14] as [number, number, number], color: '#817ba7', opacity: 0.08, offset: [-0.04, -0.08, -0.06] as [number, number, number] },
] as const

export const AUTH_SOLAR_RENDER_PROFILE = {
  fogDensity: 0.048,
  bloomStrength: 0.1,
  internalParticles: false,
  motionTrails: true,
  motionTrailOpacity: 0.3,
  trajectoryArcLength: 2.8,
  trajectoryFadeSegments: 5,
  trajectoryDepth: true,
} as const

function disposeScene(root: Scene): void {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<MeshPhysicalMaterial | MeshStandardMaterial | MeshBasicMaterial | LineBasicMaterial>()
  root.traverse((object) => {
    if ('geometry' in object && object.geometry instanceof BufferGeometry) geometries.add(object.geometry)
    if ('material' in object) {
      const list = Array.isArray(object.material) ? object.material : [object.material]
      list.forEach((material) => {
        if (material instanceof MeshPhysicalMaterial || material instanceof MeshStandardMaterial || material instanceof MeshBasicMaterial || material instanceof LineBasicMaterial) materials.add(material)
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

function addOrbit(parent: Group, radius: number, rotation: [number, number, number], color: string, opacity: number, scale: [number, number], offset: [number, number, number]): Mesh {
  const orbit = new Mesh(new TorusGeometry(radius, 0.005, 4, 180), new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, fog: false }))
  orbit.rotation.set(...rotation)
  orbit.scale.set(scale[0], scale[1], 1)
  orbit.position.set(...offset)
  orbit.name = `auth-orbit:${radius}`
  parent.add(orbit)
  return orbit
}

type AuthSolarOrbitPoint = { x: number; y: number; z: number }

export function getAuthSolarOrbitPoint(radius: number, angle: number, profile: (typeof AUTH_SOLAR_ORBIT_PROFILES)[number], z: number): AuthSolarOrbitPoint {
  const localX = Math.cos(angle) * radius * profile.scale[0]
  const localY = Math.sin(angle) * radius * profile.scale[1]
  const rotation = profile.rotation[2]
  const cosRotation = Math.cos(rotation)
  const sinRotation = Math.sin(rotation)
  return {
    x: profile.offset[0] + localX * cosRotation - localY * sinRotation,
    y: profile.offset[1] + localX * sinRotation + localY * cosRotation,
    z: profile.offset[2] + z,
  }
}

function createMotionTrail(parent: Group, planet: AuthSolarPlanet, index: number, angle: number, radius: number, profile: (typeof AUTH_SOLAR_ORBIT_PROFILES)[number]): Group {
  const trail = new Group()
  trail.name = `auth-motion-trail:${planet.label}`
  trail.userData.points = 10
  trail.userData.angle = angle
  trail.userData.radius = radius
  trail.userData.profile = profile
  trail.userData.baseZ = planet.z
  trail.userData.length = AUTH_SOLAR_RENDER_PROFILE.trajectoryArcLength * (0.76 + index * 0.08)
  for (let segmentIndex = 0; segmentIndex < AUTH_SOLAR_RENDER_PROFILE.trajectoryFadeSegments; segmentIndex += 1) {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(trail.userData.points * 3), 3))
    const progress = (segmentIndex + 1) / AUTH_SOLAR_RENDER_PROFILE.trajectoryFadeSegments
    const material = new LineBasicMaterial({ color: planet.color, transparent: true, opacity: (AUTH_SOLAR_RENDER_PROFILE.motionTrailOpacity - index * 0.022) * (0.26 + progress * 0.74), depthWrite: false, depthTest: AUTH_SOLAR_RENDER_PROFILE.trajectoryDepth, fog: false, linewidth: 1 })
    trail.add(new Line(geometry, material))
  }
  parent.add(trail)
  return trail
}

function updateMotionTrail(trail: Group, angle: number): void {
  const points = Number(trail.userData.points)
  const radius = Number(trail.userData.radius)
  const profile = trail.userData.profile as (typeof AUTH_SOLAR_ORBIT_PROFILES)[number]
  const baseZ = Number(trail.userData.baseZ)
  const length = Number(trail.userData.length)
  trail.children.forEach((child, segmentIndex) => {
    if (!(child instanceof Line)) return
    const positions = child.geometry.getAttribute('position')
    const segmentStart = angle - length + (segmentIndex / trail.children.length) * length
    const segmentEnd = angle - length + ((segmentIndex + 1) / trail.children.length) * length
    for (let index = 0; index < points; index += 1) {
      const progress = index / (points - 1)
      const trailAngle = segmentStart + progress * (segmentEnd - segmentStart)
      const point = getAuthSolarOrbitPoint(radius, trailAngle, profile, baseZ + Math.sin(trailAngle * 1.7) * 0.08)
      positions.setXYZ(index, point.x, point.y, point.z)
    }
    positions.needsUpdate = true
  })
}

function addPlanet(parent: Group, planet: AuthSolarPlanet, index: number): Group {
  const group = new Group()
  const orbitProfile = AUTH_SOLAR_ORBIT_PROFILES[planet.orbitIndex]
  const orbitRadius = AUTH_SOLAR_LAYOUT.orbits[planet.orbitIndex]
  const angle = Math.atan2(planet.y, planet.x)
  const point = getAuthSolarOrbitPoint(orbitRadius, angle, orbitProfile, planet.z)
  group.position.set(point.x, point.y, point.z)
  group.userData.speed = planet.speed
  group.userData.angle = angle
  group.userData.radius = orbitRadius
  group.userData.baseZ = planet.z
  group.userData.profile = orbitProfile
  const material = new MeshStandardMaterial({
    color: '#ffffff',
    vertexColors: true,
    emissive: new Color(planet.color).multiplyScalar(0.08),
    emissiveIntensity: 0.16,
    metalness: 0.03,
    roughness: 0.78,
  })
  const planetMesh = new Mesh(createRockGeometry(planet.radius, planet.color, index + 1), material)
  planetMesh.name = `auth-planet:${planet.label}`
  group.add(planetMesh)
  const aura = new Mesh(new SphereGeometry(planet.radius * 1.24, 20, 16), new MeshBasicMaterial({ color: planet.color, transparent: true, opacity: 0.018, depthWrite: false }))
  group.add(aura)
  if (planet.ring) {
    const ring = new Mesh(new TorusGeometry(planet.radius * 1.65, 0.006, 4, 64), new MeshBasicMaterial({ color: planet.color, transparent: true, opacity: 0.28, depthWrite: false }))
    ring.rotation.x = Math.PI * 0.58
    ring.rotation.z = Math.PI * 0.18
    group.add(ring)
  }
  group.userData.motionTrail = createMotionTrail(parent, planet, index, group.userData.angle, orbitRadius, orbitProfile)
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
    scene.fog = new FogExp2('#040914', AUTH_SOLAR_RENDER_PROFILE.fogDensity)
    const camera = new PerspectiveCamera(32, 1, 0.1, 80)
    camera.position.set(0.12, 2.2, 11.8)
    camera.lookAt(-0.6, 0.1, 0)
    scene.add(new AmbientLight('#c6d7dc', 0.39))
    scene.add(new HemisphereLight('#d7e6e8', '#081a35', 0.82))
    const keyLight = new DirectionalLight('#dce9e4', 2.45)
    keyLight.position.set(-4, 6, 4)
    scene.add(keyLight)
    const pointLight = new PointLight('#79c9c4', 6.8, 18, 1.8)
    pointLight.position.set(-0.9, 0.4, 1.8)
    scene.add(pointLight)

    const system = new Group()
    system.name = 'auth-solar-system'
    system.position.set(-0.22, -0.1, 0)
    system.scale.setScalar(0.84)
    scene.add(system)
    const orbitStage = new Group()
    orbitStage.position.set(AUTH_SOLAR_LAYOUT.core.x, AUTH_SOLAR_LAYOUT.core.y, AUTH_SOLAR_LAYOUT.core.z)
    system.add(orbitStage)
    const orbitRings = AUTH_SOLAR_LAYOUT.orbits.map((radius, index) => {
      const profile = AUTH_SOLAR_ORBIT_PROFILES[index]
      return addOrbit(orbitStage, radius, profile.rotation, profile.color, profile.opacity, profile.scale, profile.offset)
    })

    const star = new Group()
    star.name = 'auth-solar-core'
    const coreMaterial = new MeshStandardMaterial({ color: '#ffffff', vertexColors: true, emissive: '#0b5261', emissiveIntensity: 0.16, metalness: 0.04, roughness: 0.68 })
    const core = new Mesh(createRockGeometry(0.76, '#3c78a0', 9), coreMaterial)
    star.add(core)
    star.add(new Mesh(new SphereGeometry(0.96, 48, 32), new MeshBasicMaterial({ color: '#4ca8b4', transparent: true, opacity: 0.018, depthWrite: false })))
    const coreRing = new Mesh(new TorusGeometry(1.03, 0.012, 6, 96), new MeshBasicMaterial({ color: '#a1c9c6', transparent: true, opacity: 0.26, depthWrite: false }))
    coreRing.rotation.set(Math.PI * 0.48, Math.PI * 0.16, 0.2)
    star.add(coreRing)
    const coreRingTwo = new Mesh(new TorusGeometry(1.18, 0.005, 4, 120), new MeshBasicMaterial({ color: '#817ba7', transparent: true, opacity: 0.14, depthWrite: false }))
    coreRingTwo.rotation.set(Math.PI * 0.62, -0.14, 0.48)
    star.add(coreRingTwo)
    orbitStage.add(star)
    const planets = AUTH_SOLAR_LAYOUT.planets.map((planet, index) => {
      const group = addPlanet(orbitStage, planet, index)
      return group
    })
    const motionTrails = planets.map((planet) => planet.userData.motionTrail as Group)
    motionTrails.forEach((trail, index) => updateMotionTrail(trail, Number(planets[index].userData.angle)))
    const composer = new EffectComposer(renderer)
    const bloom = new UnrealBloomPass(new Vector2(1, 1), AUTH_SOLAR_RENDER_PROFILE.bloomStrength, 0.24, 0.78)
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
        orbitStage.rotation.y += delta * 0.018
        orbitStage.rotation.x = Math.sin(now * 0.00016) * 0.022
        orbitRings.forEach((ring, index) => { ring.rotation.z += delta * (index % 2 ? -0.08 : 0.055) })
        planets.forEach((planet, index) => {
          const speed = Number(planet.userData.speed)
          const nextAngle = Number(planet.userData.angle) + delta * (0.18 + speed * 0.72)
          planet.userData.angle = nextAngle
          const profile = planet.userData.profile as (typeof AUTH_SOLAR_ORBIT_PROFILES)[number]
          const point = getAuthSolarOrbitPoint(Number(planet.userData.radius), nextAngle, profile, Number(planet.userData.baseZ) + Math.sin(now * 0.00045 + index) * 0.018)
          planet.position.set(point.x, point.y, point.z)
          planet.rotation.y += delta * (0.2 + index * 0.03)
          updateMotionTrail(motionTrails[index], nextAngle)
        })
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

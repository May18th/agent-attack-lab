import { describe, expect, it } from 'vitest'
import { AUTH_SOLAR_LAYOUT, AUTH_SOLAR_ORBIT_PROFILES, AUTH_SOLAR_RENDER_PROFILE, getAuthSolarOrbitPoint } from './AuthSolarScene'

describe('auth solar scene layout', () => {
  it('keeps the main core separate from the right-side session card', () => {
    expect(AUTH_SOLAR_LAYOUT.core).toEqual({ x: -0.9, y: 0.2, z: 0 })
    expect(AUTH_SOLAR_LAYOUT.orbits).toHaveLength(4)
    expect(AUTH_SOLAR_LAYOUT.planets.map((planet) => planet.label)).toEqual(['侦测', '防守', '审计', '规则', '回放'])
    expect(AUTH_SOLAR_LAYOUT.planets.every((planet) => planet.x <= 2.7)).toBe(true)
    expect(AUTH_SOLAR_ORBIT_PROFILES).toHaveLength(AUTH_SOLAR_LAYOUT.orbits.length)
    expect(AUTH_SOLAR_ORBIT_PROFILES.some((profile) => profile.scale[0] !== profile.scale[1])).toBe(true)
  })

  it('uses a restrained profile that lets the scene blend into the page background', () => {
    expect(AUTH_SOLAR_RENDER_PROFILE.fogDensity).toBeGreaterThan(0)
    expect(AUTH_SOLAR_RENDER_PROFILE.bloomStrength).toBeLessThan(0.15)
    expect(AUTH_SOLAR_RENDER_PROFILE.internalParticles).toBe(false)
    expect(AUTH_SOLAR_RENDER_PROFILE.motionTrails).toBe(true)
    expect(AUTH_SOLAR_RENDER_PROFILE.motionTrailOpacity).toBeGreaterThan(0.2)
    expect(AUTH_SOLAR_RENDER_PROFILE.trajectoryArcLength).toBeGreaterThan(2)
    expect(AUTH_SOLAR_RENDER_PROFILE.trajectoryFadeSegments).toBeGreaterThan(1)
    expect(AUTH_SOLAR_RENDER_PROFILE.trajectoryDepth).toBe(true)
  })

  it('shares each profile transform between the orbit ring and its planet path', () => {
    const planet = AUTH_SOLAR_LAYOUT.planets[2]
    const profile = AUTH_SOLAR_ORBIT_PROFILES[planet.orbitIndex]
    const point = getAuthSolarOrbitPoint(AUTH_SOLAR_LAYOUT.orbits[planet.orbitIndex], Math.atan2(planet.y, planet.x), profile, planet.z)
    expect(point.z).toBeCloseTo(profile.offset[2] + planet.z)
    expect(point.x).not.toBeCloseTo(planet.x)
    expect(point.y).not.toBeCloseTo(planet.y)
  })
})

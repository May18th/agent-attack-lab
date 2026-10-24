import { describe, expect, it } from 'vitest'
import { AUTH_SOLAR_LAYOUT } from './AuthSolarScene'

describe('auth solar scene layout', () => {
  it('keeps the main core separate from the right-side session card', () => {
    expect(AUTH_SOLAR_LAYOUT.core).toEqual({ x: -0.9, y: 0.2, z: 0 })
    expect(AUTH_SOLAR_LAYOUT.orbits).toHaveLength(4)
    expect(AUTH_SOLAR_LAYOUT.planets.map((planet) => planet.label)).toEqual(['侦测', '防守', '审计', '规则', '回放'])
    expect(AUTH_SOLAR_LAYOUT.planets.every((planet) => planet.x <= 2.7)).toBe(true)
  })
})

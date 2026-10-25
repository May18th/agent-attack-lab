import { describe, expect, it } from 'vitest'
import { experienceForPathname } from './appRoute'

describe('experienceForPathname', () => {
  it.each(['/admin', '/admin/', '/admin/battles', '/dashboard', '/dashboard/'])('%s opens the admin experience', (pathname) => {
    expect(experienceForPathname(pathname)).toBe('admin')
  })

  it.each(['/', '/replay/battle-1', '/about'])('%s opens the public experience', (pathname) => {
    expect(experienceForPathname(pathname)).toBe('public')
  })
})

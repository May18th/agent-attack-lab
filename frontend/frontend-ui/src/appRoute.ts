export type AppExperience = 'admin' | 'public'

export function experienceForPathname(pathname: string): AppExperience {
  const isAdminRoute = pathname === '/admin' || pathname.startsWith('/admin/')
  const isDashboardAlias = pathname === '/dashboard' || pathname.startsWith('/dashboard/')
  return isAdminRoute || isDashboardAlias ? 'admin' : 'public'
}

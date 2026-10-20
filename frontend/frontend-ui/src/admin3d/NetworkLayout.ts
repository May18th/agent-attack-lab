import { CatmullRomCurve3, Group, Vector3 } from 'three'
import { replayEventCue, type AdminSceneModel, type AdminSceneNode } from './sceneModel'

export type EventFiberRoute = { routeId?: string; reversed: boolean }

export function attackRouteFiberIds(targetAssetId: string): string[] {
  const assetIndex = targetAssetId === 'network:asset:3' ? 2 : targetAssetId === 'network:asset:2' ? 1 : 0
  return [
    'network-path:1', 'team-path:1', 'network-path:2', 'network-path:3', 'network-path:4', 'network-path:5',
    `network-path:${6 + assetIndex}`, `network-path:${9 + assetIndex}`,
  ]
}

export function createSecurityRoute(
  hardwareGroups: ReadonlyMap<string, Group>,
  securityBarriers: ReadonlyMap<number, Group>,
  targetAssetId: string,
): CatmullRomCurve3 | undefined {
  const points = ['role:attacker', 'network:jump:1', 'network:jump:2'].flatMap((id) => {
    const group = hardwareGroups.get(id)
    return group ? [group.position.clone().add(new Vector3(0, 0.68, 0))] : []
  })
  securityBarriers.forEach((group) => points.push(group.position.clone().add(new Vector3(0, 0.85, 0))))
  const asset = hardwareGroups.get(targetAssetId)
  if (asset) points.push(asset.position.clone().add(new Vector3(0, 0.68, 0)))
  const defender = hardwareGroups.get('role:defender')
  if (defender) points.push(defender.position.clone().add(new Vector3(0, 0.68, 0)))
  return points.length > 1 ? new CatmullRomCurve3(points, false, 'centripetal', 0.18) : undefined
}

export function routeProgressAtPoint(route: CatmullRomCurve3 | undefined, point: Vector3): number | undefined {
  if (!route) return undefined
  let closestProgress = 0
  let closestDistance = Infinity
  for (let sample = 0; sample <= 200; sample += 1) {
    const progress = sample / 200
    const distance = route.getPointAt(progress).distanceToSquared(point)
    if (distance < closestDistance) {
      closestDistance = distance
      closestProgress = progress
    }
  }
  return closestProgress
}

export function routeProgressBoundaries(route: CatmullRomCurve3 | undefined, points: Vector3[]): number[] {
  if (!route) return []
  return points.map((point) => routeProgressAtPoint(route, point) ?? 1)
}

export function selectEventFiberRoute(node: AdminSceneNode | undefined, model: AdminSceneModel | undefined): EventFiberRoute {
  if (node?.kind !== 'timeline-event') return { reversed: false }
  const source = node.source as { eventType?: string; type?: string; data?: Record<string, unknown> } | null
  const cue = source ? replayEventCue(source) : undefined
  const actorRole = cue?.kind === 'defense-request' ? 'attacker' : cue?.kind === 'defense' ? 'defender' : node.actorRole
  const explicit = source?.data?.targetRole
  const targetRole = explicit === 'attacker' || explicit === 'defender'
    ? explicit
    : cue?.kind === 'defense-request' ? 'defender'
      : cue?.kind === 'defense' ? 'attacker'
        : cue && cue.kind !== 'other' && cue.kind !== 'session' && (node.actorRole === 'attacker' || node.actorRole === 'defender')
          ? node.actorRole === 'attacker' ? 'defender' : 'attacker'
          : undefined
  const eventIndex = Math.max(0, model?.nodes.filter((item) => item.kind === 'timeline-event').findIndex((item) => item.id === node.id) ?? 0)

  if (cue?.kind === 'defense-request' || cue?.kind === 'defense') {
    const round = source?.data?.round
    return { routeId: `network-path:${(typeof round === 'number' && round % 2 === 0) ? 6 : 3}`, reversed: cue.kind === 'defense' }
  }
  if ((cue?.kind === 'other' || cue?.kind === 'session') && (actorRole === 'attacker' || actorRole === 'defender')) {
    return { routeId: actorRole === 'attacker' ? 'team-path:1' : `team-path:${2 + (eventIndex - 1 + 2) % 2}`, reversed: false }
  }
  if ((actorRole === 'attacker' || actorRole === 'defender') && targetRole && targetRole !== actorRole) {
    const routeIndex = eventIndex % 2
    const pathIndex = cue?.kind === 'probe' ? 1 + routeIndex
      : cue?.kind === 'attack' ? routeIndex ? 6 : 3
        : cue?.kind === 'exploit' ? routeIndex ? 5 : 4
          : cue?.kind === 'compromised' ? 7 + eventIndex % 3 : 3
    return { routeId: `network-path:${pathIndex}`, reversed: actorRole === 'defender' }
  }
  return { reversed: false }
}

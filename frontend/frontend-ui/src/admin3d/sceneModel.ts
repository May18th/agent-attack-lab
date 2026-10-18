import type { AdminBattle, AdminMetrics } from '../adminApi'
import type { ExternalCase } from '../api'

export type AdminSceneNodeKind = 'attacker' | 'defender' | 'scheduler' | 'battle' | 'external-case'
export type AdminSceneStatus = 'pending' | 'running' | 'completed' | 'failed' | 'unknown'
export type AdminSceneNode = {
  id: string
  kind: AdminSceneNodeKind
  label: string
  status: AdminSceneStatus
  color: string
  position: [number, number, number]
  timestamp?: string
  source: AdminBattle | ExternalCase | AdminMetrics | null
}
export type AdminSceneEdge = { id: string; from: string; to: string; status: AdminSceneStatus; color: string }
export type AdminSceneModel = {
  nodes: AdminSceneNode[]
  edges: AdminSceneEdge[]
  statusColors: Record<AdminSceneStatus, string>
}
export type BuildAdminSceneModelInput = {
  battles: AdminBattle[]
  metrics: AdminMetrics
  externalCases: ExternalCase[]
}

const MAX_NODES = 64
const MAX_EDGES = 128
const statusColors: AdminSceneModel['statusColors'] = {
  pending: '#8b9bab', running: '#24c7bd', completed: '#62b878', failed: '#ed6b58', unknown: '#d1a84b',
}

function sceneStatus(value: string): AdminSceneStatus {
  return value in statusColors ? value as AdminSceneStatus : 'unknown'
}

function timestamp(value?: string): number {
  const parsed = value ? Date.parse(value) : 0
  return Number.isFinite(parsed) ? parsed : 0
}

export function buildAdminSceneModel(input: BuildAdminSceneModelInput): AdminSceneModel {
  const roleNodes: AdminSceneNode[] = [
    { id: 'role:attacker', kind: 'attacker', label: '攻击方', status: 'unknown', color: '#ed8b42', position: [-3, 0, 0], source: null },
    { id: 'role:defender', kind: 'defender', label: '防守方', status: 'unknown', color: '#55a7d1', position: [3, 0, 0], source: null },
    { id: 'role:scheduler', kind: 'scheduler', label: '调度中心', status: 'unknown', color: '#b6a3d8', position: [0, 0.5, -2], source: input.metrics },
  ]
  const capacity = MAX_NODES - roleNodes.length
  const battles = [...input.battles].sort((a, b) => {
    const active = Number(b.status === 'running' || b.status === 'pending') - Number(a.status === 'running' || a.status === 'pending')
    return active || timestamp(b.createdAt) - timestamp(a.createdAt)
  })
  const battleNodes: AdminSceneNode[] = battles.map((battle, index) => {
    const angle = index * 2.399963229728653
    const radius = 1.4 + Math.sqrt(index) * 0.24
    const status = sceneStatus(battle.status)
    return {
      id: `battle:${battle.id}`, kind: 'battle', label: battle.topic || battle.id, status,
      color: statusColors[status], position: [Math.cos(angle) * radius, 0, Math.sin(angle) * radius],
      timestamp: battle.createdAt, source: battle,
    }
  })
  const caseCapacity = Math.max(0, capacity - Math.min(battleNodes.length, capacity))
  const caseNodes: AdminSceneNode[] = [...input.externalCases]
    .sort((a, b) => timestamp(b.dateAdded) - timestamp(a.dateAdded))
    .slice(0, caseCapacity)
    .map((item, index) => ({
      id: `case:${item.externalId}`, kind: 'external-case', label: item.externalId, status: 'unknown', color: statusColors.unknown,
      position: [Math.cos(index * 2.4) * (4.2 + index * 0.05), 0, Math.sin(index * 2.4) * (4.2 + index * 0.05)],
      timestamp: item.dateAdded, source: item,
    }))
  const nodes = [...roleNodes, ...battleNodes.slice(0, capacity), ...caseNodes].slice(0, MAX_NODES)
  const edges: AdminSceneEdge[] = []
  for (const node of nodes) {
    if (node.kind !== 'battle' || edges.length >= MAX_EDGES) continue
    edges.push({ id: `attacker:${node.id}`, from: 'role:attacker', to: node.id, status: node.status, color: node.color })
    if (edges.length < MAX_EDGES) edges.push({ id: `defender:${node.id}`, from: node.id, to: 'role:defender', status: node.status, color: node.color })
    if (edges.length < MAX_EDGES) edges.push({ id: `scheduler:${node.id}`, from: 'role:scheduler', to: node.id, status: node.status, color: node.color })
  }
  return { nodes, edges: edges.slice(0, MAX_EDGES), statusColors }
}

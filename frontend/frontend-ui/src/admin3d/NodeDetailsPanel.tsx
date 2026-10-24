import type { AdminBattle, AdminBattleEvent, AdminBattleScore } from '../adminApi'
import type { ExternalCase } from '../api'
import type { AdminSceneNode } from './sceneModel'
import './NodeDetailsPanel.css'

type NodeDetailsPanelProps = { node: AdminSceneNode | null; score?: AdminBattleScore | null }

function battleFromNode(node: AdminSceneNode): AdminBattle | undefined {
  const source = node.source
  return source && typeof source === 'object' && 'attackerOut' in source && 'defenderOut' in source ? source as AdminBattle : undefined
}

function externalCaseFromNode(node: AdminSceneNode): ExternalCase | undefined {
  const source = node.source
  return source && typeof source === 'object' && 'externalId' in source && 'cwes' in source ? source as ExternalCase : undefined
}

type LayerInterception = {
  layer?: unknown
  blocked?: unknown
  passed?: unknown
  reached?: unknown
  total?: unknown
  owaspCategories?: unknown
  owaspCategory?: unknown
}
type LayerInterceptions = { basis?: unknown; layers?: unknown }

function defenseEventFromNode(node: AdminSceneNode): AdminBattleEvent | undefined {
  const source = node.source
  if (!source || typeof source !== 'object') return undefined
  const type = 'eventType' in source ? source.eventType : 'type' in source ? source.type : undefined
  return type === 'defense.completed' ? source as AdminBattleEvent : undefined
}

function layerInterceptionsFromNode(node: AdminSceneNode): LayerInterceptions | undefined {
  const event = defenseEventFromNode(node)
  const value = event?.data?.layerInterceptions
  return value && typeof value === 'object' ? value as LayerInterceptions : undefined
}

function eventType(event: AdminBattleEvent): string {
  return String(event.eventType ?? event.type ?? '')
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function sourceRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function categoryFromFinding(value: unknown): string | undefined {
  const finding = sourceRecord(value)
  return stringValue(finding.owaspCategory) ?? stringValue(finding.owasp)
}

function Field({ label, value }: { label: string; value: string | number }) {
  return <div className="admin3d-node-detail-field"><dt>{label}</dt><dd>{value}</dd></div>
}

function RelatedCases({ node }: { node: AdminSceneNode }) {
  const cases = node.relatedCases ?? []
  return <div className="admin3d-node-detail-related-cases">
    <dt>关联 CVE</dt>
    <dd>{cases.length ? cases.map((item) => <span key={item.externalId} title={item.title}>{item.externalId}</span>) : '未记录'}</dd>
  </div>
}

function BarrierDetails({ node }: { node: AdminSceneNode }) {
  const stats = layerInterceptionsFromNode(node)
  const layers = Array.isArray(stats?.layers) ? stats.layers.filter((item): item is LayerInterception => Boolean(item && typeof item === 'object')) : []
  const current = layers.find((item) => numberValue(item.layer) === node.barrierIndex)
  const blocked = numberValue(current?.blocked)
  const passed = numberValue(current?.passed)
  const reached = numberValue(current?.reached) ?? numberValue(current?.total)
  const basis = typeof stats?.basis === 'string' && stats.basis.trim() ? stats.basis : undefined
  const layerCategories = Array.isArray(current?.owaspCategories)
    ? current.owaspCategories.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).join('、')
    : stringValue(current?.owaspCategory)
  const derivedCategories = (node.evidenceEvents ?? [])
    .filter((event) => eventType(event) === 'round.completed')
    .flatMap((event) => {
      const data = sourceRecord(event.data)
      const findings = [
        ...(Array.isArray(data.caught) ? data.caught : []),
        ...(Array.isArray(data.risks) ? data.risks : []),
      ]
      return findings.map(categoryFromFinding).filter((category): category is string => Boolean(category))
    })
  const recordedCategories = [...new Set(derivedCategories)]
  const categorySummary = layerCategories
    || (recordedCategories.length ? `${recordedCategories.join('、')}（战局级记录，未标注具体层）` : '未记录')
  return <>
    <Field label="层级" value={`第 ${node.barrierIndex ?? '—'} 层`} />
    <Field label="拦截统计" value={blocked !== undefined && passed !== undefined
      ? `拦截 ${blocked} / ${reached ?? blocked + passed}，放行 ${passed}`
      : '未记录'} />
    <Field label="对应 OWASP 分类" value={categorySummary} />
    <Field label="统计依据" value={basis === 'derived_from_defense_results' ? '后端根据防守结果推导（非设备遥测）' : basis ?? '未记录'} />
  </>
}

function NetworkDetails({ node, battle }: { node: AdminSceneNode; battle: AdminBattle | undefined }) {
  const ordinal = node.id.match(/^network:asset:(\d+)$/)?.[1]
  const name = `${node.label}${ordinal ? `（节点 ${ordinal}）` : ''}`
  const penetration = node.networkState === 'compromised' ? '已穿透' : '未记录到已验证穿透'
  const response = battle?.status === 'completed' || node.status === 'completed'
    ? '已完成'
    : battle?.status === 'failed' || node.status === 'failed'
      ? '失败'
      : battle?.status === 'running' || node.status === 'running'
        ? '处理中'
        : battle?.status === 'pending' || node.status === 'pending'
          ? '待处理'
          : '未记录'
  return <>
    <Field label="内网名称" value={name} />
    <Field label="穿透状态" value={penetration} />
    <Field label="防守响应" value={response} />
    <p className="admin3d-node-detail-note">未关联真实资产清单；名称为拓扑节点标识。</p>
  </>
}

function RoleDetails({ node, battle, score }: { node: AdminSceneNode; battle: AdminBattle | undefined; score?: AdminBattleScore | null }) {
  const roleScore = node.kind === 'attacker' ? score?.attacker : score?.defender
  const scoreValue = typeof roleScore?.score === 'number' && typeof roleScore.maxScore === 'number'
    ? `${roleScore.score}/${roleScore.maxScore}`
    : '评分不足'
  if (node.kind === 'attacker') {
    const samples = battle?.attackerOut.samples.length ?? 0
    const attackerOut = sourceRecord(battle?.attackerOut)
    return <>
      <Field label="运行质量评分" value={scoreValue} />
      <Field label="攻击样本数" value={samples} />
      <Field label="攻击模式" value={battle?.topic || '未记录'} />
      <Field label="智能体模式" value={stringValue(attackerOut.agentMode) ?? '未记录'} />
      <Field label="攻击来源" value={stringValue(attackerOut.agentSource) ?? '未记录'} />
    </>
  }
  const defenses = battle?.defenderOut ?? []
  const findings = defenses.reduce((total, item) => total + (item.caught?.length ?? 0), 0)
  const fixes = defenses.reduce((total, item) => total + (item.fixed?.length ?? 0), 0)
  const strategies = defenses.map((item) => {
    const record = sourceRecord(item)
    return stringValue(record.analysisMode) ?? stringValue(record.strategy) ?? stringValue(record.agentMode)
  }).filter((value): value is string => Boolean(value))
  const explicitRuleCount = defenses.reduce((total, item) => {
    const value = numberValue(sourceRecord(item).ruleCount)
    return value === undefined ? total : total + Math.max(0, Math.floor(value))
  }, 0)
  const hasExplicitRuleCount = defenses.some((item) => numberValue(sourceRecord(item).ruleCount) !== undefined)
  const ruleIds = new Set(defenses.flatMap((item) => {
    const caught = Array.isArray(item.caught) ? item.caught : []
    return caught.map((finding) => stringValue(sourceRecord(finding).ruleId)).filter((ruleId): ruleId is string => Boolean(ruleId))
  }))
  const ruleCount = hasExplicitRuleCount ? explicitRuleCount : ruleIds.size
  const owasp = defenses.flatMap((item) => (item.risks ?? []).map((risk) => (risk as { owasp?: unknown; owaspCategory?: unknown; category?: unknown; type?: unknown }).owaspCategory ?? (risk as { owasp?: unknown }).owasp ?? (risk as { category?: unknown }).category ?? (risk as { type?: unknown }).type)).filter((value): value is string => typeof value === 'string' && value.trim().length > 0).join('、') || '未记录'
  return <>
    <Field label="运行质量评分" value={scoreValue} />
    <Field label="发现数" value={findings} />
    <Field label="防守策略" value={[...new Set(strategies)].join('、') || '未记录'} />
    <Field label="拦截规则数" value={ruleCount || '未记录'} />
    <Field label="修复建议" value={fixes} />
    <p className="admin3d-node-detail-text">OWASP 分类：{owasp}</p>
  </>
}

function JumpDetails({ node }: { node: AdminSceneNode }) {
  const source = sourceRecord(node.source)
  const ip = stringValue(source.deviceIp) ?? stringValue(source.ip) ?? '未记录'
  return <>
    <Field label="跳板 IP" value={ip} />
    <Field label="角色" value="攻击跳板" />
    <Field label="状态" value={node.status} />
  </>
}

function ExternalCaseDetails({ item }: { item: ExternalCase | undefined }) {
  if (!item) return <p className="admin3d-node-detail-note">案例字段未记录。</p>
  return <>
    <Field label="漏洞标题" value={item.title || '未记录'} />
    <Field label="CWE 分类" value={item.cwes.length ? item.cwes.join('、') : '未记录'} />
    <Field label="厂商 / 产品" value={`${item.vendorProject || '未记录'} / ${item.product || '未记录'}`} />
    <Field label="来源" value={item.source.publisher || '未记录'} />
    <p className="admin3d-node-detail-text">关联战局：接口未记录</p>
    {item.sourceUrl && <a className="admin3d-node-detail-link" href={item.sourceUrl} target="_blank" rel="noreferrer">查看外部来源</a>}
  </>
}

export function NodeDetailsPanel({ node, score }: NodeDetailsPanelProps) {
  if (!node) return <aside className="admin3d-node-detail-panel" aria-label="节点详情"><p className="admin3d-muted">点击 3D 节点查看结构化详情</p></aside>
  const battle = battleFromNode(node)
  return <aside className="admin3d-node-detail-panel" aria-label="节点详情">
    <div className="admin3d-node-detail-heading"><span>节点详情</span><strong>{node.kind === 'external-case' ? '只读案例' : node.kind === 'security-barrier' ? '防护层' : '运行节点'}</strong></div>
    <h3>{node.label}</h3>
    <dl>
      {node.kind === 'security-barrier' ? <BarrierDetails node={node} />
        : node.kind === 'external-case' ? <ExternalCaseDetails item={externalCaseFromNode(node)} />
            : node.kind === 'attacker' || node.kind === 'defender' ? <RoleDetails node={node} battle={battle} score={score} />
            : node.kind === 'attack-jump' ? <JumpDetails node={node} />
            : node.kind === 'defender-asset' ? <NetworkDetails node={node} battle={battle} />
            : <Field label="状态" value={node.status} />}
      {node.kind !== 'external-case' && node.relatedCases && <RelatedCases node={node} />}
    </dl>
  </aside>
}

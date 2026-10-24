import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { AdminBattle } from '../adminApi'
import type { AdminBattleScore } from '../adminApi'
import type { ExternalCase } from '../api'
import type { AdminSceneNode } from './sceneModel'
import { NodeDetailsPanel } from './NodeDetailsPanel'

afterEach(cleanup)

const battle: AdminBattle = {
  id: 'battle-details', topic: '提示注入', difficulty: 'mid', status: 'completed', createdAt: '2026-10-19',
  attackerOut: { agentSource: 'acp-llm', samples: [{ type: 'prompt', severity: 'high', content: 'sample' }] },
  defenderOut: [{ caught: [{ reason: '规则命中' }], risks: [{ level: 'high', reason: '需复核' }], fixed: [{ action: '更新策略' }] }],
}

const node = (kind: AdminSceneNode['kind'], source: AdminSceneNode['source'] = battle, extra: Partial<AdminSceneNode> = {}): AdminSceneNode => ({
  id: `${kind}:details`, kind, label: kind === 'security-barrier' ? '输入标准化清洗' : kind === 'attacker' ? '攻击方节点' : kind === 'defender' ? '防守方节点' : source && typeof source === 'object' && 'externalId' in source ? String(source.externalId) : kind, status: 'completed', color: '#00D4AA', position: [0, 0, 0], source, ...extra,
})

describe('NodeDetailsPanel', () => {
  it('keeps the empty-selection prompt until a scene node is selected', () => {
    render(<NodeDetailsPanel node={null} />)
    expect(screen.getByText('点击 3D 节点查看结构化详情')).toBeInTheDocument()
  })

  it('shows structured attacker and defender evidence from the selected battle', () => {
    const { rerender } = render(<NodeDetailsPanel node={node('attacker')} />)
    expect(screen.getByRole('heading', { name: '攻击方节点' })).toBeInTheDocument()
    expect(screen.getByText('攻击样本数')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()

    rerender(<NodeDetailsPanel node={node('defender')} />)
    expect(screen.getByRole('heading', { name: '防守方节点' })).toBeInTheDocument()
    expect(screen.getByText('发现数')).toBeInTheDocument()
    expect(screen.getByText('修复建议')).toBeInTheDocument()
    expect(screen.getByText('OWASP 分类：未记录')).toBeInTheDocument()
  })

  it('shows the required structured fields for every operational node type', () => {
    const defenseEvent = {
      eventType: 'defense.completed',
      status: 'completed',
      data: {
        layerInterceptions: {
          layers: [{ layer: 1, blocked: 2, passed: 1, reached: 3, owaspCategories: ['LLM01'] }],
        },
      },
    } as const

    const { rerender } = render(<NodeDetailsPanel node={node('attacker', {
      ...battle,
      attackerOut: { ...battle.attackerOut, agentMode: 'llm' },
    })} />)
    expect(screen.getByText('智能体模式')).toBeInTheDocument()
    expect(screen.getByText('llm')).toBeInTheDocument()
    expect(screen.getByText('攻击来源')).toBeInTheDocument()

    rerender(<NodeDetailsPanel node={node('defender', {
      ...battle,
      defenderOut: [{ ...battle.defenderOut[0], analysisMode: 'DeepSeek + OWASP 规则', ruleCount: 4 }],
    })} />)
    expect(screen.getByText('防守策略')).toBeInTheDocument()
    expect(screen.getByText('拦截规则数')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()

    rerender(<NodeDetailsPanel node={node('security-barrier', defenseEvent, { barrierIndex: 1 })} />)
    expect(screen.getByText('对应 OWASP 分类')).toBeInTheDocument()
    expect(screen.getByText('LLM01')).toBeInTheDocument()

    rerender(<NodeDetailsPanel node={node('attack-jump', battle, { label: '攻击跳板 1' })} />)
    expect(screen.getByText('跳板 IP')).toBeInTheDocument()
    expect(screen.getByText('未记录')).toBeInTheDocument()
    expect(screen.getByText('角色')).toBeInTheDocument()
  })

  it('counts distinct recorded interception rule IDs and does not substitute finding count', () => {
    const defenderBattle = {
      ...battle,
      defenderOut: [{
        caught: [{ ruleId: 'RULE-1' }, { ruleId: 'RULE-1' }, { ruleId: 'RULE-2' }],
        risks: [], fixed: [], analysisMode: '本地规则分析',
      }],
    } as unknown as AdminBattle
    const { rerender } = render(<NodeDetailsPanel node={node('defender', defenderBattle)} />)
    expect(screen.getByText('拦截规则数')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()

    rerender(<NodeDetailsPanel node={node('defender', battle)} />)
    expect(screen.getByText('拦截规则数').parentElement).toHaveTextContent('未记录')
  })

  it('shows battle-recorded OWASP categories without claiming they belong to a specific barrier', () => {
    const defenseCompleted = {
      eventType: 'defense.completed', status: 'completed', data: { layerInterceptions: { layers: [] } },
    } as const
    const roundCompleted = {
      eventType: 'round.completed', status: 'completed', data: { caught: [{ ruleId: 'OWASP-LLM01-LOCAL', owaspCategory: 'LLM01' }] },
    } as const
    render(<NodeDetailsPanel node={node('security-barrier', defenseCompleted, { barrierIndex: 1, evidenceEvents: [roundCompleted] })} />)

    expect(screen.getByText('对应 OWASP 分类')).toBeInTheDocument()
    expect(screen.getByText('LLM01（战局级记录，未标注具体层）')).toBeInTheDocument()
  })

  it('shows unavailable scoring without inventing a role score, and shows persisted values when present', () => {
    const unavailable: AdminBattleScore = {
      version: 'internal-agent-v2', status: 'insufficient_evidence',
      attacker: { status: 'insufficient_evidence', score: null, maxScore: 100, categories: [] },
      defender: { status: 'insufficient_evidence', score: null, maxScore: 100, categories: [] },
    }
    const { rerender } = render(<NodeDetailsPanel node={node('attacker')} score={unavailable} />)
    expect(screen.getByText('评分不足')).toBeInTheDocument()
    expect(screen.queryByText(/65\/100|100\/100/)).not.toBeInTheDocument()

    const persisted: AdminBattleScore = {
      ...unavailable, status: 'scored',
      attacker: { status: 'scored', score: 78, maxScore: 100, categories: [] },
      defender: { status: 'scored', score: 82, maxScore: 100, categories: [] },
    }
    rerender(<NodeDetailsPanel node={node('defender')} score={persisted} />)
    expect(screen.getByText('82/100')).toBeInTheDocument()
  })

  it('shows persisted barrier counts and their derivation basis', () => {
    const defenseCompleted = {
      eventType: 'defense.completed',
      status: 'completed',
      data: {
        layerInterceptions: {
          basis: 'derived_from_defense_results',
          layers: [
            { layer: 1, name: '输入标准化清洗', reached: 5, blocked: 3, passed: 2 },
            { layer: 2, name: '推理引导', reached: 5, blocked: 0, passed: 5 },
            { layer: 3, name: '工具动作管控', reached: 5, blocked: 0, passed: 5 },
            { layer: 4, name: '审计监测恢复', reached: 5, blocked: 0, passed: 5 },
          ],
        },
      },
    } as const
    render(<NodeDetailsPanel node={node('security-barrier', defenseCompleted, { barrierIndex: 1 })} />)
    expect(screen.getByRole('heading', { name: '输入标准化清洗' })).toBeInTheDocument()
    expect(screen.getByText('拦截统计')).toBeInTheDocument()
    expect(screen.getByText('拦截 3 / 5，放行 2')).toBeInTheDocument()
    expect(screen.getByText('统计依据')).toBeInTheDocument()
    expect(screen.getByText('后端根据防守结果推导（非设备遥测）')).toBeInTheDocument()
    expect(screen.queryByText(/模拟估算/)).not.toBeInTheDocument()
  })

  it('reports missing barrier statistics without presenting a simulated value', () => {
    render(<NodeDetailsPanel node={node('security-barrier', null, { barrierIndex: 1 })} />)
    expect(screen.getByText('拦截统计')).toBeInTheDocument()
    expect(screen.getByText('拦截统计').parentElement).toHaveTextContent('未记录')
    expect(screen.getByText('对应 OWASP 分类').parentElement).toHaveTextContent('未记录')
    expect(screen.getByText('统计依据').parentElement).toHaveTextContent('未记录')
    expect(screen.queryByText(/模拟估算/)).not.toBeInTheDocument()
  })

  it('shows network penetration and defense response states', () => {
    render(<NodeDetailsPanel node={node('defender-asset', battle, { networkState: 'compromised', status: 'completed' })} />)
    expect(screen.getByRole('heading', { name: 'defender-asset' })).toBeInTheDocument()
    expect(screen.getByText('穿透状态')).toBeInTheDocument()
    expect(screen.getByText('已穿透')).toBeInTheDocument()
    expect(screen.getByText('防守响应')).toBeInTheDocument()
    expect(screen.getByText('已完成')).toBeInTheDocument()
  })

  it('shows external vulnerability evidence and explicitly reports missing battle linkage', () => {
    const externalCase: ExternalCase = {
      externalId: 'CVE-2026-0001', vendorProject: 'Example', product: 'Gateway', title: 'Example issue', dateAdded: '2026-10-19',
      description: 'A documented vulnerability', requiredAction: 'Patch', cwes: ['CWE-79'], sourceUrl: 'https://example.test', provenanceStatus: 'verified', synthetic: false,
      recordKind: 'catalog', source: { publisher: 'NVD', sourceType: 'feed', catalogVersion: '1', retrievedAt: '2026-10-19', contentSha256: 'abc' },
    }
    render(<NodeDetailsPanel node={node('external-case', externalCase)} />)
    expect(screen.getByRole('heading', { name: 'CVE-2026-0001' })).toBeInTheDocument()
    expect(screen.getByText('Example issue')).toBeInTheDocument()
    expect(screen.getByText('CWE-79')).toBeInTheDocument()
    expect(screen.getByText('关联战局：接口未记录')).toBeInTheDocument()
  })
})

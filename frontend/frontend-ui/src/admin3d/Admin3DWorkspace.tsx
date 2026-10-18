import { useEffect, useMemo, useRef, useState } from 'react'
import type { AdminBattle, AdminExternalCases, AdminMetrics } from '../adminApi'
import { ThreeScene } from './ThreeScene'
import { buildAdminSceneModel } from './sceneModel'
import './Admin3DWorkspace.css'

type WorkspaceView = 'overview' | 'battles' | 'audit' | 'cases'

type Admin3DWorkspaceProps = {
  metrics: AdminMetrics
  battles: AdminBattle[]
  cases: AdminExternalCases | null
  selectedBattle: AdminBattle | null
  detailData: Record<string, unknown>
  onSelectBattle: (battle: AdminBattle) => void
}

const views: { id: WorkspaceView; label: string }[] = [
  { id: 'overview', label: '态势总览' },
  { id: 'battles', label: '战局' },
  { id: 'audit', label: '审计' },
  { id: 'cases', label: '案例' },
]

const jsonPreview = (value: unknown) => JSON.stringify(value ?? {}, null, 2)

export function Admin3DWorkspace({ metrics, battles, cases, selectedBattle, detailData, onSelectBattle }: Admin3DWorkspaceProps) {
  const [view, setView] = useState<WorkspaceView>('overview')
  const [motionPaused, setMotionPaused] = useState(false)
  const sceneContainerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<ThreeScene | null>(null)
  const battleRef = useRef(battles)
  const selectRef = useRef(onSelectBattle)
  const model = useMemo(() => buildAdminSceneModel({
    battles,
    metrics,
    externalCases: cases?.available ? cases.items : [],
  }), [battles, metrics, cases])
  const initialModelRef = useRef(model)

  useEffect(() => {
    battleRef.current = battles
    selectRef.current = onSelectBattle
  }, [battles, onSelectBattle])

  useEffect(() => {
    const container = sceneContainerRef.current
    if (!container) return
    const scene = new ThreeScene()
    sceneRef.current = scene
    try {
      scene.mount(container, initialModelRef.current, {
        onSelectNode: (node) => {
          if (node.kind !== 'battle') return
          const selected = battleRef.current.find((battle) => `battle:${battle.id}` === node.id)
          if (selected) selectRef.current(selected)
        },
      })
    } catch (error) {
      const fallback = document.createElement('div')
      fallback.className = 'admin3d-scene-error'
      fallback.setAttribute('role', 'status')
      fallback.textContent = error instanceof Error ? error.message : '3D 场景暂不可用'
      container.appendChild(fallback)
    }
    const observer = typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(() => window.dispatchEvent(new Event('resize')))
    observer?.observe(container)
    return () => {
      observer?.disconnect()
      scene.dispose()
      sceneRef.current = null
    }
  }, [])

  useEffect(() => { sceneRef.current?.update(model) }, [model])
  useEffect(() => { sceneRef.current?.setMotionPaused(motionPaused) }, [motionPaused])

  const sceneLegend = model.nodes.filter((node) => ['attacker', 'defender', 'scheduler'].includes(node.kind))
  const caseNodes = model.nodes.filter((node) => node.kind === 'external-case')
  const numericMetrics = Object.entries(metrics).filter(([, value]) => typeof value === 'number')

  return <section className="admin3d-workspace" aria-labelledby="admin3d-title">
    <div className="admin3d-heading">
      <div>
        <span className="admin3d-kicker">OPERATIONS / 3D WORKSPACE</span>
        <h2 id="admin3d-title">攻防态势工作台</h2>
      </div>
      <div className="admin3d-controls" aria-label="场景控制">
        <button type="button" aria-pressed={motionPaused} onClick={() => setMotionPaused((paused) => !paused)}>{motionPaused ? '继续动效' : '暂停动效'}</button>
        <button type="button" onClick={() => sceneRef.current?.resetCamera()}>重置视角</button>
        <button type="button" onClick={() => document.getElementById('admin-2d-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>查看 2D 列表</button>
      </div>
    </div>

    <div className="admin3d-layout">
      <nav className="admin3d-nav" role="tablist" aria-label="工作台视图">
        {views.map((item) => <button
          key={item.id}
          type="button"
          role="tab"
          id={`admin3d-tab-${item.id}`}
          aria-selected={view === item.id}
          aria-controls="admin3d-panel"
          onClick={() => setView(item.id)}
        >{item.label}</button>)}
      </nav>

      <div className="admin3d-scene-column">
        <div className="admin3d-scene-frame" role="region" aria-label="3D 攻防态势">
          <div className="admin3d-scene" ref={sceneContainerRef} />
          <div className="admin3d-legend" aria-label="场景图例">
            {sceneLegend.map((node) => <span key={node.id}><i style={{ backgroundColor: node.color }} />{node.label}</span>)}
          </div>
        </div>
        <div className="admin3d-statusline" aria-live="polite">
          <span><i className="status-dot" />{battles.filter((battle) => battle.status === 'running').length} 场进行中</span>
          <span>{selectedBattle ? `当前战局：${selectedBattle.topic || selectedBattle.id}` : '未选择战局'}</span>
          <span>{model.nodes.length} 个场景节点</span>
        </div>
      </div>

      <section className="admin3d-panel" id="admin3d-panel" role="tabpanel" aria-labelledby={`admin3d-tab-${view}`}>
        {view === 'overview' && <>
          <h3>运行态势</h3>
          <div className="admin3d-metrics">
            {numericMetrics.length ? numericMetrics.map(([key, value]) => <div key={key}><span>{key}</span><strong>{String(value)}</strong></div>) : <p className="admin3d-muted">暂无数值指标</p>}
          </div>
        </>}
        {view === 'battles' && <>
          <h3>战局节点</h3>
          {battles.length ? <ul className="admin3d-battle-list">{battles.map((battle) => <li key={battle.id}>
            <button type="button" className={selectedBattle?.id === battle.id ? 'is-selected' : ''} onClick={() => onSelectBattle(battle)}>
              <span className="admin3d-node-marker" style={{ backgroundColor: model.nodes.find((node) => node.id === `battle:${battle.id}`)?.color ?? model.statusColors.unknown }} />
              <span><strong>{battle.topic || battle.id}</strong><small>{battle.id} · {battle.status}</small></span>
            </button>
          </li>)}</ul> : <p className="admin3d-muted">暂无战局</p>}
        </>}
        {view === 'audit' && <>
          <h3>审计与事件</h3>
          {selectedBattle ? <>
            <p className="admin3d-context">{selectedBattle.topic || selectedBattle.id} · {selectedBattle.id}</p>
            {Object.entries(detailData).length ? <div className="admin3d-audit-list">{Object.entries(detailData).map(([key, value]) => <details key={key} open={key === '审计'}>
              <summary>{key}</summary><pre>{jsonPreview(value)}</pre>
            </details>)}</div> : <p className="admin3d-muted">暂无审计或事件数据</p>}
          </> : <p className="admin3d-muted">选择战局后查看其审计、事件和报告。</p>}
        </>}
        {view === 'cases' && <>
          <h3>独立案例节点</h3>
          {cases?.available === false ? <p className="admin3d-muted">{cases.reason || '外部案例不可用'}</p>
            : caseNodes.length ? <ul className="admin3d-case-list" aria-label="外部案例节点">{caseNodes.map((node) => {
              const item = cases?.items.find((candidate) => `case:${candidate.externalId}` === node.id)
              if (!item) return null
              return <li key={node.id}>
                <span className="admin3d-node-marker" style={{ backgroundColor: node.color }} />
                <div><strong>{item.externalId} · {item.title}</strong><p>{item.vendorProject} · {item.product} · {item.provenanceStatus}</p><small>来源哈希 {item.source.contentSha256.slice(0, 12)}</small></div>
              </li>
            })}</ul>
              : <p className="admin3d-muted">暂无匹配案例</p>}
        </>}
      </section>
    </div>
  </section>
}

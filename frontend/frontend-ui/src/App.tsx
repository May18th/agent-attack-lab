import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'

type Difficulty = 'low' | 'mid' | 'high'
type Sample = { type: string; topic: string; severity: string; content: string }
type Defense = { caught: { reason: string; type: string }[]; risks: { reason: string; level: string }[]; fixed: { action: string; status: string }[] }
type Battle = { id: string; difficulty: Difficulty; topic: string; status: 'pending' | 'running' | 'completed' | 'failed'; createdAt: string; attackerOut: { samples: Sample[] }; defenderOut: Defense[] }
type BattleEvent = { id: string; battleId: string; sequence: number; type: string; status: string; createdAt: string; data: Record<string, unknown> }

const API = import.meta.env.VITE_AGENT_API || ''
const difficultyLabels: Record<Difficulty, string> = { low: '低', mid: '中', high: '高' }
const statusLabels: Record<Battle['status'], string> = { pending: '等待中', running: '执行中', completed: '已完成', failed: '失败' }

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, options)
  if (!response.ok) throw new Error(`请求失败（${response.status}）`)
  return response.json() as Promise<T>
}

function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function App() {
  const [topic, setTopic] = useState('提示注入与输入校验')
  const [difficulty, setDifficulty] = useState<Difficulty>('mid')
  const [battles, setBattles] = useState<Battle[]>([])
  const [selected, setSelected] = useState<Battle | null>(null)
  const [events, setEvents] = useState<BattleEvent[]>([])
  const [query, setQuery] = useState('')
  const [filterDifficulty, setFilterDifficulty] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [online, setOnline] = useState(false)

  const loadBattle = useCallback(async (battleId: string) => {
    const battle = await request<Battle>(`/battles/${battleId}`)
    setSelected(battle)
    setEvents(await request<BattleEvent[]>(`/battles/${battle.id}/events`))
    return battle
  }, [])

  const selectBattle = useCallback(async (battle: Battle) => {
    try {
      await loadBattle(battle.id)
    } catch {
      setSelected(battle)
      setEvents([])
    }
  }, [loadBattle])

  const loadBattles = useCallback(async () => {
    const params = new URLSearchParams({ limit: '100' })
    if (query.trim()) params.set('q', query.trim())
    if (filterDifficulty) params.set('difficulty', filterDifficulty)
    const data = await request<Battle[]>(`/battles?${params.toString()}`)
    setBattles(data)
    if (!selected && data[0]) await selectBattle(data[0])
  }, [filterDifficulty, query, selected, selectBattle])

  useEffect(() => {
    request<{ status: string }>('/health').then(() => setOnline(true)).catch(() => setOnline(false))
    // oxlint-disable-next-line react/set-state-in-effect
    loadBattles().catch((err: Error) => setError(err.message))
  }, [loadBattles])

  useEffect(() => {
    const timer = window.setInterval(() => {
      loadBattles().catch(() => undefined)
      if (selected) loadBattle(selected.id).catch(() => undefined)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [loadBattle, loadBattles, selected])

  const summary = useMemo(() => battles.reduce((result, battle) => {
    result.total += 1
    if (battle.difficulty === 'high') result.high += 1
    result.rounds += battle.attackerOut.samples.length
    result.risks += battle.defenderOut.reduce((sum, item) => sum + item.risks.length, 0)
    return result
  }, { total: 0, high: 0, rounds: 0, risks: 0 }), [battles])

  const startBattle = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!topic.trim()) return
    setBusy(true)
    setError('')
    try {
      const battle = await request<Battle>('/battles?background=true', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic, difficulty }) })
      await loadBattle(battle.id)
      await loadBattles()
    } catch (err) {
      setError(err instanceof Error ? err.message : '战局创建失败')
    } finally {
      setBusy(false)
    }
  }

  const reportUrl = selected ? `${API}/reports/${selected.id}?format=markdown` : '#'
  const eventTypes = new Set(events.map((event) => event.type))

  return (
    <div className="app-shell">
      <header className="topbar">
        <div><p className="eyebrow">AGENT ATTACK LAB</p><h1>智能体攻防实验室</h1><p className="subtitle">对抗过程控制台 · 事件记录 · 风险复盘</p></div>
        <div className="service-status"><span className={`status-dot ${online ? 'online' : ''}`} />{online ? '服务运行正常' : '正在连接后端'}</div>
      </header>

      <main className="dashboard">
        <section className="metric-grid">
          <div className="metric-card"><span>战局总数</span><strong>{summary.total}</strong><small>当前筛选结果</small></div>
          <div className="metric-card orange"><span>高难度战局</span><strong>{summary.high}</strong><small>需要重点复盘</small></div>
          <div className="metric-card green"><span>对抗轮次</span><strong>{summary.rounds}</strong><small>已记录攻击样本</small></div>
          <div className="metric-card red"><span>风险项</span><strong>{summary.risks}</strong><small>防守侧识别结果</small></div>
        </section>

        <div className="workspace-grid">
          <aside className="sidebar">
            <section className="panel create-panel">
              <div className="panel-heading"><div><p className="eyebrow">NEW BATTLE</p><h2>开始新战局</h2></div><span className="panel-number">01</span></div>
              <form onSubmit={startBattle}>
                <label htmlFor="topic">测试主题</label>
                <input id="topic" value={topic} onChange={(event) => setTopic(event.target.value)} maxLength={200} />
                <label>对抗难度</label>
                <div className="difficulty-options">{(['low', 'mid', 'high'] as Difficulty[]).map((value) => <button key={value} type="button" className={difficulty === value ? 'selected' : ''} onClick={() => setDifficulty(value)}><b>{difficultyLabels[value]}</b><span>{value === 'low' ? '基础缺陷' : value === 'mid' ? '规则违规' : '复合漏洞'}</span></button>)}</div>
                <button className="primary-button" disabled={busy}>{busy ? '攻防执行中...' : '开始攻防'}</button>
              </form>
            </section>
            <section className="panel history-panel">
              <div className="panel-heading"><div><p className="eyebrow">BATTLE LOG</p><h2>历史战局</h2></div><span className="panel-number">{battles.length}</span></div>
              <div className="filters"><input placeholder="搜索主题或编号" value={query} onChange={(event) => setQuery(event.target.value)} /><select value={filterDifficulty} onChange={(event) => setFilterDifficulty(event.target.value)}><option value="">全部难度</option><option value="low">低难度</option><option value="mid">中难度</option><option value="high">高难度</option></select></div>
              <div className="battle-list">{battles.length ? battles.map((battle) => <button className={`battle-item ${selected?.id === battle.id ? 'active' : ''}`} key={battle.id} onClick={() => selectBattle(battle)}><span className={`severity ${battle.difficulty}`}>{difficultyLabels[battle.difficulty]}</span><span className="battle-item-main"><b>{battle.topic}</b><small>{formatTime(battle.createdAt)} · {battle.attackerOut.samples.length} 轮</small></span><span className="arrow">›</span></button>) : <div className="empty-state">暂无符合条件的战局</div>}</div>
            </section>
          </aside>

          <section className="panel detail-panel">
            {error && <div className="error-banner">{error}</div>}
            {selected ? <>
              <div className="detail-heading"><div><p className="eyebrow">BATTLE DETAIL</p><h2>{selected.topic}</h2><p className="detail-meta">{selected.id} · {difficultyLabels[selected.difficulty]}难度 · {statusLabels[selected.status]} · {formatTime(selected.createdAt)}</p></div><a className="secondary-button" href={reportUrl} target="_blank" rel="noreferrer">导出 Markdown</a></div>
              <div className="process-flow"><div className={`flow-node ${eventTypes.has('battle.created') ? 'done' : ''}`}><i>1</i><span>战局创建</span><small>{eventTypes.has('battle.created') ? '已完成' : statusLabels[selected.status]}</small></div><div className="flow-line" /><div className={`flow-node ${eventTypes.has('attack.completed') ? 'done' : ''}`}><i>2</i><span>攻击生成</span><small>{eventTypes.has('attack.completed') ? `${selected.attackerOut.samples.length} 个样本` : '等待中'}</small></div><div className="flow-line" /><div className={`flow-node ${eventTypes.has('defense.completed') ? 'done' : ''}`}><i>3</i><span>防守检测</span><small>{eventTypes.has('defense.completed') ? `${selected.defenderOut.reduce((sum, item) => sum + item.caught.length, 0)} 项发现` : '等待中'}</small></div><div className="flow-line" /><div className={`flow-node ${eventTypes.has('battle.completed') ? 'done' : ''}`}><i>4</i><span>修复建议</span><small>{eventTypes.has('battle.completed') ? `${selected.defenderOut.reduce((sum, item) => sum + item.fixed.length, 0)} 项动作` : '等待中'}</small></div></div>
              <div className="section-heading"><h3>逐轮对抗</h3><span>{selected.attackerOut.samples.length} rounds</span></div>
              <div className="round-list">{selected.attackerOut.samples.map((sample, index) => { const defense = selected.defenderOut[index] || { caught: [], risks: [], fixed: [] }; return <article className="round-card" key={`${selected.id}-${index}`}><div className="round-title"><b>第 {index + 1} 轮</b><span className="type-tag">{sample.type}</span><span className={`level-tag ${sample.severity}`}>{sample.severity}</span><span className="round-complete">已完成</span></div><div className="round-columns"><div className="attack-side"><h4>攻击方 · 样本生成</h4><p className="sample-topic">{sample.topic}</p><p>{sample.content}</p></div><div className="defense-side"><h4>防守方 · 检测与修复</h4><ResultList label="发现问题" items={defense.caught.map((item) => item.reason)} empty="未发现问题" /><ResultList label="风险评估" items={defense.risks.map((item) => `${item.level} · ${item.reason}`)} empty="无额外风险" /><ResultList label="修复动作" items={defense.fixed.map((item) => `${item.action} · ${item.status}`)} empty="无需修复" /></div></div></article> })}</div>
              <div className="section-heading event-heading"><h3>事件时间线</h3><span>{statusLabels[selected.status]} · 持久化审计记录</span></div>
              <div className="timeline">{events.map((event) => <div className="timeline-item" key={event.id}><span className="timeline-index">{String(event.sequence).padStart(2, '0')}</span><span className="timeline-dot" /><div><b>{event.type}</b><small>{formatTime(event.createdAt)} · {event.status}</small></div></div>)}</div>
            </> : <div className="empty-detail"><div className="empty-icon">+</div><h2>选择或创建一场战局</h2><p>完整的攻击样本、防守结果和事件时间线将在这里展示。</p></div>}
          </section>
        </div>
      </main>
    </div>
  )
}

function ResultList({ label, items, empty }: { label: string; items: string[]; empty: string }) {
  return <div className="result-group"><span>{label}</span>{items.length ? <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="muted">{empty}</p>}</div>
}

export default App

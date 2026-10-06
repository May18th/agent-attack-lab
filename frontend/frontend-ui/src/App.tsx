import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type Difficulty = 'low' | 'mid' | 'high'
type Sample = { type: string; topic?: string; severity: string; content: string }
type Defense = { caught?: Array<{ reason?: string; type?: string }>; risks?: Array<{ reason?: string; level?: string }>; fixed?: Array<{ action?: string; status?: string }> }
type Battle = { id: string; difficulty: Difficulty; topic: string; status: string; createdAt: string; attackerOut: { samples: Sample[] }; defenderOut: Defense[] }

const API_BASE = (import.meta.env.VITE_AGENT_API ?? 'http://127.0.0.1:8787').replace(/\/$/, '')
const difficultyLabel: Record<Difficulty, string> = { low: '低', mid: '中', high: '高' }

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(API_BASE + path, { headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) }, ...options })
  if (!response.ok) {
    let detail = ''
    try { const body = await response.json() as { detail?: string }; detail = body.detail ?? '' } catch { /* non-json error */ }
    throw new Error(detail || 'HTTP ' + response.status)
  }
  return response.json() as Promise<T>
}

function App() {
  const [topic, setTopic] = useState('提示注入与输入校验')
  const [difficulty, setDifficulty] = useState<Difficulty>('mid')
  const [battles, setBattles] = useState<Battle[]>([])
  const [selected, setSelected] = useState<Battle | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const loadHistory = async () => {
    try {
      const items = await api<Battle[]>('/battles?limit=50')
      setBattles(items)
      if (!selected && items[0]) setSelected(items[0])
    } catch (error) {
      setMessage('历史战局加载失败：' + (error instanceof Error ? error.message : '网络错误'))
    }
  }

  useEffect(() => {
    api<{ status: string }>('/health').then(() => setStatus('ok')).catch(() => setStatus('error'))
    void loadHistory()
  }, [])

  const filtered = useMemo(() => battles.filter((battle) => !search || battle.topic.includes(search) || battle.id.includes(search)), [battles, search])
  const count = (battle: Battle | null, key: 'caught' | 'risks' | 'fixed') => battle?.defenderOut.reduce((total, result) => total + (result[key]?.length ?? 0), 0) ?? 0

  const createBattle = async (event: FormEvent) => {
    event.preventDefault()
    if (!topic.trim() || busy) return
    setBusy(true); setMessage('')
    try {
      const battle = await api<Battle>('/battles', { method: 'POST', body: JSON.stringify({ topic: topic.trim(), difficulty }) })
      setSelected(battle)
      await loadHistory()
      setMessage('战局创建完成')
    } catch (error) {
      setMessage('战局创建失败：' + (error instanceof Error ? error.message : '网络错误'))
    } finally { setBusy(false) }
  }

  const exportMarkdown = () => {
    if (!selected) return
    const lines = ['# ' + selected.topic, '', '- 战局ID：' + selected.id, '- 难度：' + difficultyLabel[selected.difficulty], '- 创建时间：' + new Date(selected.createdAt).toLocaleString('zh-CN'), '', '## 对抗轮次', '']
    selected.attackerOut.samples.forEach((sample, index) => {
      const defense = selected.defenderOut[index] ?? {}
      lines.push('### 第 ' + (index + 1) + ' 轮 · ' + sample.type, '', '**攻击样本**', '', '~~~', sample.content, '~~~', '', '**防守结果**', '', ...(defense.caught ?? []).map((item) => '- 发现：' + (item.reason ?? item.type ?? '未命名')), ...(defense.risks ?? []).map((item) => '- 风险：' + (item.reason ?? item.level ?? '未命名')), ...(defense.fixed ?? []).map((item) => '- 修复：' + (item.action ?? '已处理')), '')
    })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/markdown' }))
    link.download = selected.topic + '.md'; link.click(); URL.revokeObjectURL(link.href)
  }

  return <div className="page">
    <header className="topbar"><div><div className="eyebrow">AGENT ATTACK LAB</div><h1>智能体<em>攻防实验室</em></h1><p className="sub">后端联调控制台 · 实时战局 · 风险复盘</p></div><div className={'status ' + status}><span className="dot" />{status === 'loading' ? '正在检查服务' : status === 'ok' ? '服务运行正常' : '服务连接失败'}</div></header>
    <section className="stats">{[['战局总数', battles.length, '#4da3ff'], ['高难度战局', battles.filter((item) => item.difficulty === 'high').length, '#ffb54d'], ['攻击样本', selected?.attackerOut.samples.length ?? 0, '#3ddc97'], ['风险项', count(selected, 'risks'), '#ff5d6c']].map(([label, value, color]) => <div className="glass stat-card" style={{ '--ac': color } as React.CSSProperties} key={String(label)}><h3>{label}</h3><div className="stat-num">{value}</div><div className="stat-note">来自后端实时数据</div></div>)}</section>
    <main className="layout"><div className="col-left">
      <section className="glass card"><div className="card-head"><div><div className="en">NEW BATTLE</div><h2>开始新战局</h2></div></div><form onSubmit={createBattle}><label>测试主题<input className="input" value={topic} maxLength={200} onChange={(event) => setTopic(event.target.value)} /></label><label>对抗难度<div className="diff-grid">{(['low', 'mid', 'high'] as Difficulty[]).map((item) => <label key={item}><input type="radio" name="difficulty" checked={difficulty === item} onChange={() => setDifficulty(item)} /><span className="diff-item"><b>{difficultyLabel[item]}</b><small>{item === 'low' ? '基础缺陷' : item === 'mid' ? '规则违规' : '复合漏洞'}</small></span></label>)}</div></label><button className="btn-primary" disabled={busy}>{busy ? '攻防进行中...' : '开始攻防'}</button></form></section>
      <section className="glass card history"><div className="card-head"><div><div className="en">BATTLE LOG</div><h2>历史战局</h2></div><span className="en">{filtered.length}</span></div><input className="input" placeholder="搜索主题或编号" value={search} onChange={(event) => setSearch(event.target.value)} /><div className="battle-list">{filtered.length ? filtered.map((battle) => <button className={'battle-item ' + (selected?.id === battle.id ? 'active' : '')} key={battle.id} onClick={() => setSelected(battle)}><span className={'battle-badge ' + battle.difficulty}>{difficultyLabel[battle.difficulty]}</span><span className="bi-main"><b>{battle.topic}</b><small>{new Date(battle.createdAt).toLocaleString('zh-CN')} · {battle.status}</small></span><span className="arrow">›</span></button>) : <div className="empty">暂无历史战局</div>}</div></section>
    </div>
    <section className="glass card detail">{selected ? <><div className="detail-head"><div><h2>{selected.topic}</h2><div className="detail-meta">{selected.id} · {difficultyLabel[selected.difficulty]}难度 · {new Date(selected.createdAt).toLocaleString('zh-CN')}</div></div><button className="btn-ghost" onClick={exportMarkdown}>导出 Markdown</button></div><div className="steps">{[['战局创建', '已完成'], ['攻击生成', selected.attackerOut.samples.length + '个样本'], ['防守检测', count(selected, 'caught') + '项发现'], ['修复建议', count(selected, 'fixed') + '项动作']].map(([title, sub], index) => <div className="step" key={title}><div className="n">{index + 1}</div><b>{title}</b><small>{sub}</small></div>)}</div><div className="rounds-head"><h3>逐轮对抗 <small>ROUNDS</small></h3><span className="total">{selected.attackerOut.samples.length} rounds</span></div><div className="rounds-scroll">{selected.attackerOut.samples.map((sample, index) => { const defense = selected.defenderOut[index] ?? {}; return <article className="round-card" key={selected.id + '-' + index}><div className="round-head"><b>第 {index + 1} 轮</b><span className="pill">{sample.type} · {sample.severity}</span><span className="state">已完成</span></div><div className="round-body"><div className="side atk"><h4>攻击方 · 样本生成</h4><span className="code-chip">{sample.topic ?? selected.topic}</span><div className="sample">{sample.content}</div></div><div className="side def"><h4>防守方 · 检测与修复</h4><Finding label="发现问题" items={defense.caught?.map((item) => item.reason ?? item.type) ?? []} empty="未发现问题" /><Finding label="风险评估" items={defense.risks?.map((item) => item.reason ?? item.level) ?? []} empty="无额外风险" /><Finding label="修复动作" items={defense.fixed?.map((item) => item.action ?? item.status) ?? []} empty="无需修复" /></div></div></article> })}</div></> : <div className="empty detail-empty">提交主题后开始一轮攻防，或选择历史战局查看详情。</div>}</section></main>{message && <div className="toast show">{message}</div>}
  </div>
}

function Finding({ label, items, empty }: { label: string; items: Array<string | undefined>; empty: string }) {
  return <div className="finding"><span className="k">{label}</span><span className="v">{items.filter(Boolean).join('；') || empty}</span></div>
}

export default App


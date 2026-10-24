import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Activity, Archive, ChevronLeft, ChevronRight, Download, Play, RefreshCw, Search, Shield, Swords, Trash2, X } from 'lucide-react'
import './App.css'
import { ApiError, api, apiErrorMessage, apiPage, deleteBattle, getBattleScore, getExternalCases, retryBattle } from './api'
import type { AgentSource, Battle, BattleScore, DashboardSummary, Difficulty, ExternalCase } from './api'

const PAGE_SIZE = 10
const DEFAULT_TOPIC = '提示注入与输入校验'
const BattleScene = lazy(() => import('./BattleScene'))
const difficultyLabel: Record<Difficulty, string> = { low: '低（Low）', mid: '中（Medium）', high: '高（High）' }
const difficultyDetail: Record<Difficulty, string> = { low: '基础缺陷', mid: '规则违规', high: '复合漏洞' }
const sampleTypeLabel: Record<string, string> = { defect: '缺陷（Defect）', violation: '违规（Violation）', vuln: '漏洞（Vulnerability）' }
const statusLabel: Record<string, string> = { pending: '等待中', running: '进行中', completed: '已完成', failed: '失败', recommended: '建议' }
const sourceNames: Record<string, string> = { 'acp-llm': '独立 Agent（模型生成）', 'acp-rule-fallback': '独立 Agent（规则兜底）', 'local-rule': '本地规则引擎' }

function sourceLabel(source?: AgentSource) {
  return source ? sourceNames[source] ?? `来源未知（${source}）` : '来源未知'
}

function readBattleId() { return new URLSearchParams(window.location.search).get('battle_id') }
function readDifficulty(): Difficulty {
  const value = new URLSearchParams(window.location.search).get('difficulty')
  return value === 'low' || value === 'mid' || value === 'high' ? value : 'mid'
}
function count(battle: Battle | null, key: 'caught' | 'risks' | 'fixed') {
  return battle?.defenderOut.reduce((total, item) => total + (item[key]?.length ?? 0), 0) ?? 0
}

function Modal({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: ReactNode }) {
  return <div className="modal-mask" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <header><div><span>{eyebrow}</span><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>
      <div className="modal-body">{children}</div>
    </section>
  </div>
}

function ScoreView({ score, loading, message }: { score: BattleScore | null; loading: boolean; message: string }) {
  if (loading) return <div className="panel-empty"><RefreshCw className="spin" size={18} /> 正在读取裁判评分</div>
  if (!score?.attacker || !score?.defender) return <div className="panel-empty">{message || '当前战局暂无后端评分数据'}</div>
  return <div className="score-grid">
    {[['ATTACKER', score.attacker, 'red'], ['DEFENDER', score.defender, 'blue']].map(([name, role, color]) => {
      const item = role as BattleScore['attacker']
      return <article className={`score-side ${color}`} key={String(name)}>
        <span>{name as string}</span><strong>{item.score ?? '—'}<small> / {item.maxScore}</small></strong>
        <div className="score-bar"><i style={{ width: `${Math.max(0, Math.min(100, Number(item.score ?? 0)))}%` }} /></div>
        {item.categories?.map((category) => <div className="score-row" key={category.id ?? category.label}><span>{category.label}</span><b>{category.score} / {category.maxScore}</b></div>)}
        {item.message && <p>{item.message}</p>}
      </article>
    })}
  </div>
}

function App() {
  const [topic, setTopic] = useState(() => new URLSearchParams(window.location.search).get('topic')?.slice(0, 200) || DEFAULT_TOPIC)
  const [difficulty, setDifficulty] = useState<Difficulty>(readDifficulty)
  const [battles, setBattles] = useState<Battle[]>([])
  const [selected, setSelected] = useState<Battle | null>(null)
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyPage, setHistoryPage] = useState(0)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [health, setHealth] = useState<'loading' | 'ok' | 'error'>('loading')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [topicError, setTopicError] = useState('')
  const [score, setScore] = useState<BattleScore | null>(null)
  const [scoreLoading, setScoreLoading] = useState(false)
  const [scoreMessage, setScoreMessage] = useState('')
  const [modal, setModal] = useState<'score' | 'cases' | null>(null)
  const [externalCases, setExternalCases] = useState<ExternalCase[]>([])
  const [caseSearch, setCaseSearch] = useState('')
  const [caseMessage, setCaseMessage] = useState('')
  const [caseLoading, setCaseLoading] = useState(false)
  const requestRef = useRef(0)
  const selectedIdRef = useRef<string | null>(null)
  const scoreRequestRef = useRef(0)

  const checkHealth = useCallback(async () => {
    setHealth('loading')
    try { await api<{ status: string }>('/health'); setHealth('ok') } catch { setHealth('error') }
  }, [])

  const loadScore = useCallback(async (id: string) => {
    const request = ++scoreRequestRef.current
    setScore(null); setScoreMessage(''); setScoreLoading(true)
    try {
      const result = await getBattleScore(id)
      if (request !== scoreRequestRef.current || selectedIdRef.current !== id) return
      setScore(result)
    }
    catch (error) {
      if (request !== scoreRequestRef.current || selectedIdRef.current !== id) return
      setScoreMessage(error instanceof ApiError && (error.status === 401 || error.status === 403)
        ? '评分接口需要后台鉴权，公开页暂不可查看'
        : error instanceof ApiError && error.status === 404 ? '后端尚未生成本局评分' : '评分加载失败：' + apiErrorMessage(error))
    } finally {
      if (request === scoreRequestRef.current) setScoreLoading(false)
    }
  }, [])

  const loadBattle = useCallback(async (id: string) => {
    selectedIdRef.current = id
    scoreRequestRef.current += 1
    setScore(null); setScoreMessage('')
    try {
      const battle = await api<Battle>(`/battles/${encodeURIComponent(id)}`)
      if (selectedIdRef.current !== id) return
      setSelected(battle)
      if (battle.status === 'completed' || battle.status === 'failed') void loadScore(battle.id)
    } catch (error) { setMessage('战局详情加载失败：' + apiErrorMessage(error)) }
  }, [loadScore])

  const loadHistory = useCallback(async (page = 0, query = '', selectFirst = false) => {
    const request = ++requestRef.current
    setHistoryLoading(true)
    try {
      const suffix = query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ''
      const result = await apiPage<Battle>(`/battles?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}${suffix}`)
      if (request !== requestRef.current) return
      setBattles(result.items); setHistoryTotal(result.total); setHistoryPage(page)
      if (selectFirst && !readBattleId() && result.items[0]) void loadBattle(result.items[0].id)
    } catch (error) { if (request === requestRef.current) setMessage('历史战局加载失败：' + apiErrorMessage(error)) }
    finally { if (request === requestRef.current) setHistoryLoading(false) }
  }, [loadBattle])

  const loadSummary = useCallback(async () => {
    try { setSummary(await api<DashboardSummary>('/dashboard/summary')) }
    catch (error) { setMessage('统计摘要加载失败：' + apiErrorMessage(error)) }
  }, [])

  const loadCases = useCallback(async (query = '') => {
    setCaseLoading(true); setCaseMessage('')
    try {
      const result = await getExternalCases(query)
      setExternalCases(Array.isArray(result.items) ? result.items : [])
      if (!result.available) setCaseMessage(result.reason || '外部案例源暂不可用')
    } catch (error) { setCaseMessage('外部案例加载失败：' + apiErrorMessage(error)) }
    finally { setCaseLoading(false) }
  }, [])

  useEffect(() => {
    // Remote synchronization intentionally updates state after mount.
    // oxlint-disable-next-line react/set-state-in-effect
    void checkHealth(); void loadHistory(0, '', true); void loadSummary()
    const id = readBattleId(); if (id) void loadBattle(id)
  }, [checkHealth, loadBattle, loadHistory, loadSummary])

  const openBattle = (id: string) => {
    const url = new URL(window.location.href); url.searchParams.set('battle_id', id)
    window.history.pushState({ id }, '', url.pathname + url.search); void loadBattle(id)
  }

  const createBattle = async (event: FormEvent) => {
    event.preventDefault(); const clean = topic.trim()
    if (!clean) { setTopicError('请输入测试主题'); return }
    if (busy) return
    setTopicError(''); setMessage(''); setBusy(true)
    try {
      const battle = await api<Battle>('/battles', { method: 'POST', body: JSON.stringify({ topic: clean, difficulty }) })
      selectedIdRef.current = battle.id
      setSelected(battle); setMessage('战局创建完成')
      await Promise.all([loadHistory(0, search), loadSummary()])
    } catch (error) { setMessage('战局创建失败：' + apiErrorMessage(error)) }
    finally { setBusy(false) }
  }

  const handleDelete = async () => {
    if (!selected || !window.confirm(`确认删除战局“${selected.topic}”？此操作不可撤销。`)) return
    setBusy(true)
    try { await deleteBattle(selected.id); selectedIdRef.current = null; scoreRequestRef.current += 1; setSelected(null); setScore(null); await Promise.all([loadHistory(0, search, true), loadSummary()]); setMessage('战局已删除') }
    catch (error) { setMessage('删除失败：' + apiErrorMessage(error)) }
    finally { setBusy(false) }
  }

  const handleRetry = async () => {
    if (!selected) return
    setBusy(true)
    try { const battle = await retryBattle(selected.id); setSelected(battle); setMessage('已创建重试战局'); await loadHistory(0, search) }
    catch (error) { setMessage('重试失败：' + apiErrorMessage(error)) }
    finally { setBusy(false) }
  }

  const exportMarkdown = () => {
    if (!selected) return
    const rows = [`# ${selected.topic}`, '', `- 战局 ID：${selected.id}`, `- 状态：${statusLabel[selected.status] ?? selected.status}`, `- 难度：${difficultyLabel[selected.difficulty]}`, '', '## 对抗回合', '']
    selected.attackerOut.samples.forEach((sample, index) => {
      const defense = selected.defenderOut[index]
      rows.push(`### Round ${index + 1} · ${sampleTypeLabel[sample.type] ?? sample.type}`, '', '```text', sample.content, '```', '', `- 发现：${defense?.caught?.map((x) => x.reason ?? x.type).join('；') || '无记录'}`, `- 风险：${defense?.risks?.map((x) => x.reason ?? x.level).join('；') || '无记录'}`, `- 修复：${defense?.fixed?.map((x) => x.action ?? x.status).join('；') || '无记录'}`, '')
    })
    const href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/markdown' }))
    const link = document.createElement('a'); link.href = href; link.download = `${selected.topic}.md`; link.click(); URL.revokeObjectURL(href)
  }

  const totalPages = Math.max(1, Math.ceil(historyTotal / PAGE_SIZE))
  const stats = [
    ['TOTAL BATTLES', summary?.totalBattles ?? '—', '已保存战局', 'cyan'], ['ATTACK SAMPLES', summary?.sampleCount ?? '—', '已保存样本', 'red'],
    ['RULE HITS', summary?.ruleHitCount ?? '—', '防守命中', 'amber'], ['RISK RECORDS', summary?.riskCount ?? '—', '风险记录', 'violet'],
    ['RULE LIBRARY', summary?.ruleLibraryCaseCount ?? '—', `规则库用例 · ACP 调用场次：${summary?.acpCallBattles ?? '—'}`, 'green'],
  ]

  return <div className="console-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><Shield size={19} /></span><div><strong>智能体攻防实验室</strong><small>AGENT ATTACK LAB · COMMAND CENTER</small></div></div>
      <nav aria-label="快捷功能"><button onClick={() => setModal('score')} disabled={!selected}><Activity size={16} />实时评分</button><button onClick={() => { setModal('cases'); if (!externalCases.length) void loadCases() }}><Archive size={16} />安全案例</button></nav>
      <button aria-label={health === 'ok' ? '服务运行正常' : health === 'loading' ? '正在检查服务' : '服务连接失败，点击重试'} className={`health ${health}`} onClick={() => health === 'error' && void checkHealth()} disabled={health === 'loading'}><i />{health === 'ok' ? 'SYSTEM ONLINE' : health === 'loading' ? 'CONNECTING' : 'RECONNECT'}</button>
    </header>

    <main>
      <section className="hero-stage"><Suspense fallback={<div className="scene-loading">正在加载三维战场</div>}><BattleScene battle={selected} /></Suspense><div className="hero-copy"><span>LIVE DEFENSE SIMULATION</span><h1>智能体攻防<br /><em>战局总控台</em></h1><p>攻击生成、分层防御与裁判评分统一呈现。当前画面仅映射真实战局状态，不推演后端未返回的数据。</p></div><div className="battle-hud"><span>CURRENT OPERATION</span><strong>{selected?.topic ?? '等待选择战局'}</strong><small>{selected ? `${selected.id} · ${difficultyLabel[selected.difficulty]} · ${statusLabel[selected.status] ?? selected.status}` : '从历史记录选择，或发起一场新攻防'}</small></div></section>
      {selected && <div className="sr-only"><span>攻击来源：{sourceLabel(selected.attackerOut.agentSource)}</span><span>防守来源：{sourceLabel(selected.defenderOut[0]?.agentSource)}</span><span>{sampleTypeLabel[selected.attackerOut.samples[0]?.type] ?? selected.attackerOut.samples[0]?.type} · {difficultyLabel[selected.difficulty]}</span></div>}
      <section className="stats" aria-label="真实统计口径（Persisted statistics）">{stats.map(([name, value, label, tone]) => <article className={`stat ${tone}`} key={String(name)}><span>{name}</span><strong>{value}</strong><small>{label}</small></article>)}</section>

      <section className="workspace">
        <aside className="control-column">
          <section className="panel create-panel"><div className="panel-heading"><div><span>MISSION CONFIG</span><h2>发起新战局</h2></div><Swords size={19} /></div><form onSubmit={createBattle} noValidate><label htmlFor="topic">测试主题</label><input id="topic" value={topic} maxLength={200} aria-invalid={Boolean(topicError)} onChange={(event) => { setTopic(event.target.value); if (topicError) setTopicError('') }} /><div className="field-line">{topicError ? <b role="alert">{topicError}</b> : <span>描述本次授权测试目标</span>}<span>{topic.length}/200</span></div><label>对抗难度</label><div className="difficulty-control">{(['low', 'mid', 'high'] as Difficulty[]).map((item) => <label key={item}><input type="radio" name="difficulty" checked={difficulty === item} onChange={() => setDifficulty(item)} /><span><b>{difficultyLabel[item]}</b><small>{difficultyDetail[item]}</small></span></label>)}</div><button className="primary" type="submit" disabled={busy}><Play size={16} fill="currentColor" />{busy ? '战局处理中' : '开始攻防'}</button></form></section>
          <section className="panel history"><div className="panel-heading"><div><span>BATTLE ARCHIVE</span><h2>历史战局</h2></div><b>{historyTotal}</b></div><div className="search"><Search size={15} /><input aria-label="搜索历史战局" placeholder="主题或战局 ID" value={search} onChange={(event) => { setSearch(event.target.value); void loadHistory(0, event.target.value) }} /></div><div className="battle-list">{historyLoading ? <div className="panel-empty">正在同步战局</div> : battles.length ? battles.map((battle) => <button className={selected?.id === battle.id ? 'active' : ''} key={battle.id} onClick={() => openBattle(battle.id)}><i className={battle.difficulty}>{difficultyLabel[battle.difficulty]}</i><span><b>{battle.topic}</b><small>{new Date(battle.createdAt).toLocaleString('zh-CN')} · {statusLabel[battle.status] ?? battle.status}</small></span><ChevronRight size={16} /></button>) : <div className="panel-empty">暂无匹配记录</div>}</div><div className="pagination"><button aria-label="上一页" disabled={historyPage === 0 || historyLoading} onClick={() => void loadHistory(historyPage - 1, search)}><ChevronLeft size={16} /></button><span>第 {historyPage + 1} / {totalPages} 页 · 每页 {PAGE_SIZE} 场</span><button aria-label="下一页" disabled={historyPage + 1 >= totalPages || historyLoading} onClick={() => void loadHistory(historyPage + 1, search)}><ChevronRight size={16} /></button></div></section>
        </aside>

        <section className="panel battle-detail">{selected ? <><div className="detail-top"><div><span>BATTLE REPORT</span><h2>{selected.topic}</h2><p>{selected.id} · {new Date(selected.createdAt).toLocaleString('zh-CN')}</p></div><div className="detail-actions"><button title="导出 Markdown" aria-label="导出 Markdown" onClick={exportMarkdown}><Download size={17} /></button>{selected.status === 'failed' && <button title="重试战局" aria-label="重试战局" onClick={() => void handleRetry()} disabled={busy}><RefreshCw size={17} /></button>}<button className="danger" title="删除战局" aria-label="删除战局" onClick={() => void handleDelete()} disabled={busy}><Trash2 size={17} /></button></div></div><div className="flow-strip">{[['01', 'CREATE', statusLabel[selected.status] ?? selected.status], ['02', 'ATTACK', `${selected.attackerOut.samples.length} samples`], ['03', 'DETECT', `${count(selected, 'caught')} findings`], ['04', 'REMEDIATE', `${count(selected, 'fixed')} actions`]].map(([number, name, detail]) => <div key={number}><i>{number}</i><span><b>{name}</b><small>{detail}</small></span></div>)}</div><div className="agent-meta"><span><i className="red-dot" />ATTACKER：{sourceLabel(selected.attackerOut.agentSource)}</span><span><i className="blue-dot" />DEFENDER：{sourceLabel(selected.defenderOut[0]?.agentSource)}</span></div><div className="rounds"><div className="section-title"><span>ROUND TELEMETRY</span><h3>逐轮对抗记录</h3></div>{selected.attackerOut.samples.length ? selected.attackerOut.samples.map((sample, index) => { const defense = selected.defenderOut[index]; return <article className="round" key={`${selected.id}-${index}`}><header><span>ROUND {String(index + 1).padStart(2, '0')}</span><b>{sampleTypeLabel[sample.type] ?? sample.type} · {sample.severity}</b><em>COMPLETED</em></header><div className="round-grid"><div className="attack-output"><h4>ATTACKER · 攻击样本</h4><p>{sample.content}</p>{sample.simulation && <small>模拟样本，不代表真实目标已验证</small>}</div><div className="defense-output"><h4>DEFENDER · 检测与修复</h4><dl><dt>发现问题</dt><dd>{defense?.caught?.map((item) => item.reason ?? item.type).join('；') || '无记录'}</dd><dt>风险评估</dt><dd>{defense?.risks?.map((item) => item.reason ?? item.level).join('；') || '无记录'}</dd><dt>修复动作</dt><dd>{defense?.fixed?.map((item) => item.action ?? item.status).join('；') || '无记录'}</dd></dl></div></div></article> }) : <div className="panel-empty">该战局尚未生成攻击样本</div>}</div></> : <div className="detail-placeholder"><Shield size={40} /><span>NO ACTIVE BATTLE</span><h2>选择战局查看完整攻防记录</h2><p>或者在左侧配置测试主题，创建新的授权安全实验。</p></div>}</section>
      </section>
    </main>

    {message && <div className="toast" role="status"><Activity size={16} />{message}<button aria-label="关闭消息" onClick={() => setMessage('')}><X size={15} /></button></div>}
    {modal === 'score' && <Modal eyebrow="ARBITER SCORE" title="实时评分系统" onClose={() => setModal(null)}><ScoreView score={score} loading={scoreLoading} message={scoreMessage} /></Modal>}
    {modal === 'cases' && <Modal eyebrow="EXTERNAL INTELLIGENCE" title="外部安全案例" onClose={() => setModal(null)}><div className="case-search"><input aria-label="搜索外部案例" value={caseSearch} onChange={(event) => setCaseSearch(event.target.value)} placeholder="搜索 CVE、厂商或产品" /><button onClick={() => void loadCases(caseSearch)} disabled={caseLoading}><Search size={16} />查询</button></div>{caseLoading ? <div className="panel-empty">正在读取可信案例源</div> : caseMessage ? <div className="panel-empty">{caseMessage}</div> : <div className="case-list">{externalCases.map((item) => <article key={item.externalId}><header><b>{item.externalId}</b><span>{item.provenanceStatus}</span></header><h3>{item.title}</h3><p>{item.vendorProject} · {item.product} · {item.dateAdded}</p><small>{item.description}</small><a href={item.sourceUrl} target="_blank" rel="noreferrer">查看 {item.source.publisher} 原始记录</a></article>)}</div>}</Modal>}
  </div>
}

export default App

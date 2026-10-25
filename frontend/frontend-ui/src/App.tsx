import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import {
  api,
  apiErrorMessage,
  apiPage,
  deleteBattle,
  getBattle,
  getBattleScore,
  getExternalCases,
  retryBattle,
  ApiError,
} from './api'
import type { AgentSource, Battle, BattleScore, DashboardSummary, Difficulty, ExternalCase } from './api'
const PAGE_SIZE = 10
const DEFAULT_TOPIC = '提示注入与输入校验'
const difficultyLabel: Record<Difficulty, string> = { low: '低（Low）', mid: '中（Medium）', high: '高（High）' }
const sampleTypeLabel: Record<string, string> = { defect: '缺陷（Defect）', violation: '违规（Violation）', vuln: '漏洞（Vulnerability）' }
const statusLabel: Record<string, string> = { pending: '等待中（Pending）', running: '进行中（Running）', completed: '已完成（Completed）', failed: '失败（Failed）', recommended: '建议（Recommended）' }
const findingLabel: Record<string, string> = {
  'missing input validation': '缺少输入校验（Missing input validation）',
  'unvalidated input': '未校验输入（Unvalidated input）',
  add_input_validation: '增加输入校验（Add input validation）',
}

function displayLabel(value?: string): string {
  if (!value) return ''
  return findingLabel[value] ?? statusLabel[value] ?? value
}

function readReplayBattleId(): string | null {
  const match = window.location.pathname.match(/^\/replay\/([^/]+)\/?$/)
  if (match) {
    try { return decodeURIComponent(match[1]) } catch { return match[1] }
  }
  return new URLSearchParams(window.location.search).get('battle_id')
}

function readDifficulty(): Difficulty {
  const value = new URLSearchParams(window.location.search).get('difficulty')
  return value === 'low' || value === 'mid' || value === 'high' ? value : 'mid'
}

function appBasePath(): string {
  const base = import.meta.env.BASE_URL || '/'
  return base.endsWith('/') ? base : base + '/'
}

const agentSourceLabel: Record<string, string> = {
  'acp-llm': '独立 Agent（模型生成）',
  'acp-rule-fallback': '独立 Agent（规则兜底）',
  'local-rule': '本地规则引擎',
}

function sourceLabel(source?: AgentSource): string {
  return source ? agentSourceLabel[source] ?? `来源未知（${source}）` : '来源未知'
}

function App() {
  const [topic, setTopic] = useState(() => new URLSearchParams(window.location.search).get('topic')?.slice(0, 200) || DEFAULT_TOPIC)
  const [difficulty, setDifficulty] = useState<Difficulty>(readDifficulty)
  const [battles, setBattles] = useState<Battle[]>([])
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyPage, setHistoryPage] = useState(0)
  const [selected, setSelected] = useState<Battle | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')
  const [historyLoading, setHistoryLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [topicError, setTopicError] = useState('')
  const [message, setMessage] = useState('')
  const [externalCases, setExternalCases] = useState<ExternalCase[]>([])
  const [externalCaseTotal, setExternalCaseTotal] = useState(0)
  const [externalCaseSources, setExternalCaseSources] = useState(0)
  const [externalCaseSearch, setExternalCaseSearch] = useState('')
  const [externalCaseLoading, setExternalCaseLoading] = useState(false)
  const [externalCaseMessage, setExternalCaseMessage] = useState('')
  const [battleScore, setBattleScore] = useState<BattleScore | null>(null)
  const [scoreMessage, setScoreMessage] = useState('')
  const [scoreLoading, setScoreLoading] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const historyRequestId = useRef(0)
  const selectedIdRef = useRef<string | null>(null)
  const scoreRequestId = useRef(0)

  const loadBattleScore = useCallback(async (battleId: string) => {
    const requestId = ++scoreRequestId.current
    setScoreLoading(true)
    setBattleScore(null)
    setScoreMessage('')
    try {
      const score = await getBattleScore(battleId)
      if (requestId !== scoreRequestId.current || selectedIdRef.current !== battleId) return
      setBattleScore(score)
    } catch (error) {
      if (requestId !== scoreRequestId.current || selectedIdRef.current !== battleId) return
      setBattleScore(null)
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        setScoreMessage('评分接口需要后台鉴权，公开页暂不可查看')
      } else if (error instanceof ApiError && error.status === 404) {
        setScoreMessage('暂无评分数据')
      } else {
        setScoreMessage('评分加载失败：' + apiErrorMessage(error))
      }
    } finally {
      if (requestId === scoreRequestId.current) setScoreLoading(false)
    }
  }, [])

  const loadBattleDetail = useCallback(async (battleId: string) => {
    selectedIdRef.current = battleId
    scoreRequestId.current += 1
    setBattleScore(null)
    setScoreMessage('')
    try {
      const detail = await getBattle(battleId)
      if (selectedIdRef.current !== battleId) return
      setSelected(detail)
      if (detail.status === 'completed' || detail.status === 'failed') {
        void loadBattleScore(detail.id)
      } else {
        setScoreLoading(false)
      }
    } catch (error) {
      if (selectedIdRef.current !== battleId) return
      setMessage('战局详情加载失败：' + apiErrorMessage(error))
    }
  }, [loadBattleScore])

  const loadHistory = useCallback(async (page: number, restoreFirst = false, queryValue = '') => {
    const requestId = ++historyRequestId.current
    setHistoryLoading(true)
    try {
      const query = queryValue.trim() ? `&q=${encodeURIComponent(queryValue.trim())}` : ''
      const result = await apiPage<Battle>(`/battles?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}${query}`)
      if (requestId !== historyRequestId.current) return
      setBattles(result.items)
      setHistoryTotal(result.total)
      setHistoryPage(page)
      if (restoreFirst && result.items[0] && !readReplayBattleId()) {
        setSelected((current) => current ?? result.items[0])
        void loadBattleDetail(result.items[0].id)
      }
    } catch (error) {
      if (requestId === historyRequestId.current) setMessage('历史战局加载失败：' + apiErrorMessage(error))
    } finally {
      if (requestId === historyRequestId.current) setHistoryLoading(false)
    }
  }, [loadBattleDetail])

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await api<DashboardSummary>('/dashboard/summary'))
    } catch (error) {
      setMessage('统计摘要加载失败：' + apiErrorMessage(error))
    }
  }, [])

  const loadExternalCases = useCallback(async (query = '') => {
    setExternalCaseLoading(true)
    try {
      const result = await getExternalCases(query)
      if (!result || result.available !== true) {
        setExternalCases([])
        setExternalCaseTotal(0)
        setExternalCaseSources(0)
        setExternalCaseMessage('本机未加载外部案例库')
        return
      }
      setExternalCases(result.items)
      setExternalCaseTotal(result.total)
      setExternalCaseSources(result.sourceCount)
      setExternalCaseMessage('')
    } catch (error) {
      setExternalCaseMessage('外部案例加载失败：' + apiErrorMessage(error))
    } finally {
      setExternalCaseLoading(false)
    }
  }, [])

  const checkHealth = useCallback(async () => {
    // Health checks are explicit external synchronization, including retry clicks.
    // oxlint-disable-next-line react/set-state-in-effect
    setStatus('loading')
    try {
      await api<{ status: string }>('/health')
      setStatus('ok')
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    // Public experience does not depend on a browser or organization login session.
    // oxlint-disable-next-line react/set-state-in-effect
    void checkHealth()
    // Load public data for the visitor-facing experience.
    // oxlint-disable-next-line react/set-state-in-effect
    void loadHistory(0, true)
    // Async initialization intentionally restores a shareable replay URL.
    // oxlint-disable-next-line react/set-state-in-effect
    const replayBattleId = readReplayBattleId()
    if (replayBattleId) void loadBattleDetail(replayBattleId)
    // oxlint-disable-next-line react/set-state-in-effect
    void loadSummary()
    void loadExternalCases()
  }, [checkHealth, loadHistory, loadBattleDetail, loadSummary, loadExternalCases])

  useEffect(() => {
    const restoreRoute = () => {
      const replayBattleId = readReplayBattleId()
      if (replayBattleId) void loadBattleDetail(replayBattleId)
      else {
        setSelected(null)
        selectedIdRef.current = null
        scoreRequestId.current += 1
        setScoreLoading(false)
        setBattleScore(null)
        setScoreMessage('')
      }
    }
    window.addEventListener('popstate', restoreRoute)
    return () => window.removeEventListener('popstate', restoreRoute)
  }, [loadBattleDetail])

  useEffect(() => {
    if (!selected || (selected.status !== 'pending' && selected.status !== 'running')) return
    const battleId = selected.id
    const timer = window.setInterval(() => {
      if (selectedIdRef.current !== battleId) return
      void (async () => {
        try {
          const detail = await getBattle(battleId)
          if (selectedIdRef.current !== battleId) return
          setSelected(detail)
          if (detail.status === 'completed' || detail.status === 'failed') {
            void loadBattleScore(detail.id)
            void loadHistory(historyPage, false, search)
            void loadSummary()
          }
        } catch {
          // Keep polling until the battle settles or the user leaves.
        }
      })()
    }, 2500)
    return () => window.clearInterval(timer)
  }, [selected, historyPage, search, loadBattleScore, loadHistory, loadSummary])

  const count = (battle: Battle | null, key: 'caught' | 'risks' | 'fixed') => battle?.defenderOut.reduce((total, result) => total + (result[key]?.length ?? 0), 0) ?? 0
  const totalPages = Math.max(1, Math.ceil(historyTotal / PAGE_SIZE))

  const openReplay = (battleId: string) => {
    const url = new URL(window.location.href)
    url.pathname = appBasePath()
    url.searchParams.set('battle_id', battleId)
    window.history.pushState({ battleId }, '', url.pathname + url.search)
    void loadBattleDetail(battleId)
  }

  const clearReplayUrl = () => {
    const url = new URL(window.location.href)
    url.pathname = appBasePath()
    url.searchParams.delete('battle_id')
    window.history.replaceState({}, '', url.pathname + url.search)
  }

  const handleDeleteBattle = async () => {
    if (!selected || actionBusy) return
    if (selected.status === 'pending' || selected.status === 'running') {
      setMessage('运行中的战局不能删除')
      return
    }
    if (!window.confirm(`确认删除战局「${selected.topic}」？删除后不可恢复。`)) return
    setActionBusy(true)
    setMessage('')
    try {
      await deleteBattle(selected.id)
      setSelected(null)
      selectedIdRef.current = null
      scoreRequestId.current += 1
      setScoreLoading(false)
      setBattleScore(null)
      setScoreMessage('')
      clearReplayUrl()
      await Promise.all([loadHistory(historyPage, false, search), loadSummary()])
      setMessage('战局已删除')
    } catch (error) {
      setMessage('删除失败：' + apiErrorMessage(error))
    } finally {
      setActionBusy(false)
    }
  }

  const handleRetryBattle = async () => {
    if (!selected || selected.status !== 'failed' || actionBusy) return
    setActionBusy(true)
    setMessage('')
    try {
      const battle = await retryBattle(selected.id)
      scoreRequestId.current += 1
      setSelected(battle)
      selectedIdRef.current = battle.id
      setScoreLoading(false)
      setBattleScore(null)
      setScoreMessage('')
      await Promise.all([loadHistory(historyPage, false, search), loadSummary()])
      setMessage('失败战局已重新提交')
    } catch (error) {
      setMessage('重试失败：' + apiErrorMessage(error))
    } finally {
      setActionBusy(false)
    }
  }

  const validateTopic = (value: string): string => {
    const trimmed = value.trim()
    if (!trimmed) return '请输入攻防主题'
    if (trimmed.length > 200) return '主题不能超过 200 个字符'
    return ''
  }

  const createBattle = async (event: FormEvent) => {
    event.preventDefault()
    const validationError = validateTopic(topic)
    setTopicError(validationError)
    if (validationError || busy) return
    setBusy(true); setMessage('')
    try {
      const battle = await api<Battle>('/battles', { method: 'POST', body: JSON.stringify({ topic: topic.trim(), difficulty }) })
      setSelected(battle)
      selectedIdRef.current = battle.id
      if (battle.status === 'completed' || battle.status === 'failed') void loadBattleScore(battle.id)
      else {
        setBattleScore(null)
        setScoreMessage('')
      }
      clearReplayUrl()
      await Promise.all([loadHistory(0, false, search), loadSummary()])
      setMessage('战局创建完成')
    } catch (error) {
      setMessage('战局创建失败：' + apiErrorMessage(error))
    } finally { setBusy(false) }
  }

  const exportMarkdown = () => {
    if (!selected) return
    const lines = ['# ' + selected.topic, '', '- 战局ID（Battle ID）：' + selected.id, '- 难度（Difficulty）：' + difficultyLabel[selected.difficulty], '- 创建时间（Created）：' + new Date(selected.createdAt).toLocaleString('zh-CN'), '', '## 对抗轮次（Rounds）', '']
    selected.attackerOut.samples.forEach((sample, index) => {
      const defense = selected.defenderOut[index] ?? {}
      lines.push('### 第 ' + (index + 1) + ' 轮（Round ' + (index + 1) + '） · ' + (sampleTypeLabel[sample.type] ?? sample.type), '', '**攻击样本（Attack sample）**', '', '~~~', sample.content, '~~~', '', '**防守结果（Defense result）**', '', ...(defense.caught ?? []).map((item) => '- 发现（Finding）：' + displayLabel(item.reason ?? item.type ?? '未命名')), ...(defense.risks ?? []).map((item) => '- 风险（Risk）：' + displayLabel(item.reason ?? item.level ?? '未命名')), ...(defense.fixed ?? []).map((item) => '- 修复（Remediation）：' + displayLabel(item.action ?? item.status ?? '已处理')), '')
    })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/markdown' }))
    link.download = selected.topic + '.md'; link.click(); URL.revokeObjectURL(link.href)
  }

  return <div className="page">
    <header className="topbar"><div><div className="eyebrow">智能体攻防实验室（AGENT ATTACK LAB）</div><h1>智能体<em>攻防实验室</em></h1><p className="sub">公开攻防体验（Public security lab） · 后端执行并持久化战局 · 风险分析（Risk review）</p></div><div className="topbar-actions"><a className="admin-link" href="/admin">管理员后台</a><button className={'status ' + status} type="button" onClick={() => void checkHealth()} disabled={status === 'loading'}><span className="dot" />{status === 'loading' ? '正在检查服务（Checking service）' : status === 'ok' ? '服务运行正常（Service healthy）· 点击刷新检查' : '服务连接失败（Connection failed）· 点击重试（Retry）'}</button></div></header>
    <main className="layout"><div className="col-left">
      <section className="glass card"><div className="card-head"><div><div className="en">开始新战局（NEW BATTLE）</div><h2>开始新战局（New battle）</h2></div></div><form onSubmit={createBattle} noValidate><label htmlFor="topic">攻防主题（Battle topic）<input id="topic" className="input" value={topic} maxLength={200} aria-invalid={Boolean(topicError)} aria-describedby={topicError ? 'topic-error' : 'topic-count'} onChange={(event) => { const value = event.target.value; setTopic(value); if (topicError) setTopicError(validateTopic(value)) }} />{topicError ? <span className="field-error" id="topic-error" role="alert">{topicError}</span> : <span className="field-hint" id="topic-count">{topic.length}/200</span>}</label><label>对抗难度（Difficulty）<div className="diff-grid">{(['low', 'mid', 'high'] as Difficulty[]).map((item) => <label key={item}><input type="radio" name="difficulty" checked={difficulty === item} onChange={() => setDifficulty(item)} /><span className="diff-item"><b>{difficultyLabel[item]}</b><small>{item === 'low' ? '基础缺陷（Basic defect）' : item === 'mid' ? '规则违规（Rule violation）' : '复合漏洞（Compound vulnerability）'}</small></span></label>)}</div></label><p className="operation-notice"><span>战局会真实写入后端并同步到后台；当前分析对象为合成安全样本，不会向外部目标发起请求。</span><span className="operation-notice-detail">合成安全样本 · 未向外部目标发起请求</span></p><button className="btn-primary" type="submit" disabled={busy}>{busy ? '攻防执行中（Battle running）...' : '开始攻防（Start battle）'}</button></form></section>
    <section className="glass card history"><div className="card-head"><div><div className="en">历史战局（BATTLE LOG）</div><h2>历史战局（Battle history）</h2></div><span className="en">{historyTotal} 场</span></div><input className="input" placeholder="搜索主题或编号（Search topic or ID）" value={search} onChange={(event) => { const value = event.target.value; setSearch(value); void loadHistory(0, false, value) }} />{historyLoading ? <div className="empty" role="status">正在加载历史战局（Loading battle history）...</div> : <div className="battle-list">{battles.length ? battles.map((battle) => <button className={'battle-item ' + (selected?.id === battle.id ? 'active' : '')} key={battle.id} onClick={() => openReplay(battle.id)}><span className={'battle-badge ' + battle.difficulty}>{difficultyLabel[battle.difficulty]}</span><span className="bi-main"><b>{battle.topic}</b><small>{new Date(battle.createdAt).toLocaleString('zh-CN')} · {displayLabel(battle.status)}</small></span><span className="arrow">›</span></button>) : <div className="empty">暂无匹配记录（No matching battles）</div>}</div>}<div className="pagination"><button type="button" className="btn-ghost" disabled={historyLoading || historyTotal === 0 || historyPage === 0} onClick={() => void loadHistory(historyPage - 1, false, search)}>上一页</button>{historyTotal > 0 && <span>第 {historyPage + 1} / {totalPages} 页 · 每页 {PAGE_SIZE} 场</span>}<button type="button" className="btn-ghost" disabled={historyLoading || historyTotal === 0 || historyPage + 1 >= totalPages} onClick={() => void loadHistory(historyPage + 1, false, search)}>下一页</button></div></section>
    </div>
    <section className="glass card detail">{selected ? <><div className="detail-head"><div><h2>{selected.topic}</h2><div className="detail-meta">{selected.id} · {difficultyLabel[selected.difficulty]}难度（Difficulty） · {displayLabel(selected.status)} · {new Date(selected.createdAt).toLocaleString('zh-CN')}</div><div className="source-meta"><span>攻击来源：{sourceLabel(selected.attackerOut.agentSource)}</span><span>防守来源：{sourceLabel(selected.defenderOut[0]?.agentSource)}</span></div></div><div className="detail-actions"><button className="btn-ghost" type="button" onClick={exportMarkdown}>导出 Markdown</button>{selected.status === 'failed' && <button className="btn-ghost" type="button" disabled={actionBusy} onClick={() => void handleRetryBattle()}>重试失败战局</button>}{(selected.status === 'completed' || selected.status === 'failed') && <button className="btn-danger" type="button" disabled={actionBusy} onClick={() => void handleDeleteBattle()}>删除战局</button>}</div></div><div className="steps">{[['战局创建（Create battle）', displayLabel(selected.status)], ['攻击生成（Generate attacks）', selected.attackerOut.samples.length + ' 个样本（samples）'], ['防守检测（Detect）', count(selected, 'caught') + ' 项发现（findings）'], ['修复建议（Remediate）', count(selected, 'fixed') + ' 项动作（actions）']].map(([title, sub], index) => <div className="step" key={title}><div className="n">{index + 1}</div><b>{title}</b><small>{sub}</small></div>)}</div><section className="score-panel" aria-label="内部运行质量评分">{scoreLoading ? <div className="empty" role="status">正在计算攻击与防守评分…</div> : battleScore ? <><div className="score-head"><h3>内部运行质量评分</h3><span className="en">{battleScore.version}</span></div><p className="score-note">{battleScore.message || '分别衡量攻击/防守输出完整度与可审计性；不代表漏洞检出准确率或真实目标修复效果。'}</p><div className="score-grid"><ScoreRole title="攻击方" role={battleScore.attacker} /><ScoreRole title="防守方" role={battleScore.defender} /></div></> : scoreMessage ? <div className="empty">{scoreMessage}</div> : null}</section><div className="rounds-head"><h3>逐轮对抗（Rounds） <small>ROUNDS</small></h3><span className="total">{selected.attackerOut.samples.length} rounds</span></div><div className="rounds-scroll">{selected.attackerOut.samples.length ? selected.attackerOut.samples.map((sample, index) => { const defense = selected.defenderOut[index] ?? {}; return <article className="round-card" key={selected.id + '-' + index}><div className="round-head"><b>第 {index + 1} 轮（Round {index + 1}）</b><span className="pill">{sampleTypeLabel[sample.type] ?? sample.type} · {difficultyLabel[sample.severity as Difficulty] ?? sample.severity}</span><span className="state">{displayLabel(selected.status)}</span></div><div className="round-body"><div className="side atk"><h4>攻击方 · 样本生成（Attacker · Sample generation）</h4><span className="code-chip">来源（Source）：{sourceLabel(selected.attackerOut.agentSource)}</span><span className="code-chip">主题（Topic）：{sample.topic ?? selected.topic}</span><div className="sample"><span className="sample-label">原始样本（Raw sample）</span>{sample.content}</div></div><div className="side def"><h4>防守方 · 检测与修复（Defender · Detection & remediation）</h4><span className="code-chip">来源（Source）：{sourceLabel(defense.agentSource)}</span><Finding label="发现问题（Findings）" items={defense.caught?.map((item) => displayLabel(item.reason ?? item.type)) ?? []} empty="未发现问题（No findings）" /><Finding label="风险评估（Risk assessment）" items={defense.risks?.map((item) => displayLabel(item.reason ?? item.level)) ?? []} empty="无额外风险（No additional risks）" /><Finding label="修复动作（Remediation）" items={defense.fixed?.map((item) => displayLabel(item.action ?? item.status)) ?? []} empty="无需修复（No remediation needed）" />{defense.scopeNotice && <div className="finding"><span className="k">范围说明（Scope）</span><span className="v">{defense.scopeNotice}</span></div>}</div></div></article> }) : <div className="empty">{selected.status === 'pending' || selected.status === 'running' ? '攻防进行中，正在等待样本与检测结果…' : '本场暂无对抗轮次'}</div>}</div></> : <div className="empty detail-empty">提交主题后开始一轮攻防（Submit a topic to start），或选择历史战局查看详情（Select a battle to view details）。</div>}</section></main>
    {selected?.attackerOut.samples.some((sample) => sample.simulation === true) && <p className="sample-scope-note">本场处理的是合成安全样本；没有向真实目标发起请求。</p>}
    <section className="stats" aria-label="真实统计口径（Persisted statistics）">{[
      ['已保存战局（Saved battles）', summary?.totalBattles ?? '—', '全部已保存战局数量', '#4da3ff'],
      ['内置规则项（Built-in rules）', summary?.ruleLibraryCaseCount ?? '—', '内置规则库中唯一编号的条目数', '#ffb54d'],
      ['已保存样本（Saved samples）', summary?.sampleCount ?? '—', '历史战局实际生成并保存的样本总数', '#3ddc97'],
      ['规则命中（Rule hits）', summary?.ruleHitCount ?? '—', '防守结果 caught 条目累计数', '#38c9ff'],
      ['风险记录（Risk records）', summary?.riskCount ?? '—', '防守结果 risks 条目累计数', '#ff5d6c'],
    ].map(([label, value, note, color]) => <div className="glass stat-card" style={{ '--ac': color } as React.CSSProperties} key={String(label)}><h3>{label}</h3><div className="stat-num">{value}</div><div className="stat-note">{note}</div></div>)}</section>
    <p className="stats-note">统计来自后端已保存战局。ACP 调用场次：{summary?.acpCallBattles ?? '—'}，表示至少一次成功调用了独立 ACP Agent；不代表真实目标已验证。规则库用例数是模板库规模，已保存样本数是历史战局产出，两者口径不同。{summary && summary.sampleCount === summary.ruleHitCount && summary.sampleCount === summary.riskCount ? '当前历史数据中三项恰好相同；它们分别汇总样本、caught 命中条目和 risks 风险条目，新增未命中样本后会按实际记录分开变化。' : ''}</p>
    <details className="glass card external-cases" aria-label="外部安全案例库（External case references）"><summary className="external-cases-summary"><div className="card-head"><div><div className="en">外部安全案例（EXTERNAL CASES）</div><h2>外部安全案例库（External references）</h2></div><span className="en">{externalCaseTotal} 条 · {externalCaseSources} 个来源</span></div></summary><div className="external-cases-content"><div className="external-toolbar"><input className="input" aria-label="搜索外部案例" placeholder="搜索 CVE、标题、厂商或产品" value={externalCaseSearch} onChange={(event) => setExternalCaseSearch(event.target.value)} /><button className="btn-ghost" type="button" onClick={() => void loadExternalCases(externalCaseSearch)} disabled={externalCaseLoading}>查询</button></div>{externalCaseLoading ? <div className="empty" role="status">正在加载外部案例</div> : externalCaseMessage ? <div className="empty">{externalCaseMessage}</div> : externalCases.length ? <div className="external-case-list">{externalCases.map((item) => <article className="external-case" key={item.externalId}><div className="external-case-head"><strong>{item.externalId}</strong><span>{item.provenanceStatus} · {item.recordKind}</span></div><h3>{item.title}</h3><p className="external-case-meta">{item.vendorProject} · {item.product} · 加入目录 {item.dateAdded}</p><p>{item.description}</p><div className="external-case-source">来源：{item.source.publisher} · 目录 {item.source.catalogVersion} · <a href={item.sourceUrl} target="_blank" rel="noreferrer">查看原始来源</a><span title={item.source.contentSha256}> · SHA-256 {item.source.contentSha256.slice(0, 12)}…</span></div></article>)}</div> : <div className="empty">暂无匹配的外部案例</div>}</div></details>
{message && <div className="toast show">{message}</div>}
  </div>
}

function Finding({ label, items, empty }: { label: string; items: Array<string | undefined>; empty: string }) {
  return <div className="finding"><span className="k">{label}</span><span className="v">{items.filter(Boolean).join('；') || empty}</span></div>
}

function ScoreRole({ title, role }: { title: string; role: BattleScore['attacker'] }) {
  const scoreText = role.score === null || role.score === undefined ? '证据不足' : `${role.score} / ${role.maxScore}`
  return <div className="score-role"><strong>{title}：{scoreText}</strong>{role.message && <p className="score-note">{role.message}</p>}<ul>{(role.categories ?? []).map((item) => <li key={item.id ?? item.label}>{item.label} {item.score}/{item.maxScore}{item.basis ? `（${item.basis}）` : ''}</li>)}</ul></div>
}

export default App


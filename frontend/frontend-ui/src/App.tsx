import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import { api, apiErrorMessage, apiPage, getBrowserSession, loginBrowser, logoutBrowser } from './api'
import type { AgentSource, Battle, BrowserSession, DashboardSummary, Difficulty } from './api'
import LoginPage from './LoginPage'
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
  const [session, setSession] = useState<BrowserSession | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [loginPassword, setLoginPassword] = useState('')
  const [loginBusy, setLoginBusy] = useState(false)
  const [loginError, setLoginError] = useState('')
  const historyRequestId = useRef(0)

  const refreshSession = useCallback(async () => {
    try {
      const current = await getBrowserSession()
      setSession(current)
      return current
    } catch (error) {
      setSession(null)
      setMessage('登录状态检查失败：' + apiErrorMessage(error))
      return null
    } finally {
      setSessionLoading(false)
    }
  }, [])

  const loadBattleDetail = useCallback(async (battleId: string) => {
    try {
      const detail = await api<Battle>(`/battles/${encodeURIComponent(battleId)}`)
      setSelected(detail)
    } catch (error) {
      setMessage('战局详情加载失败：' + apiErrorMessage(error))
    }
  }, [])

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
    // Health is public; protected data waits for the browser session check below.
    // oxlint-disable-next-line react/set-state-in-effect
    void checkHealth()
    // oxlint-disable-next-line react/set-state-in-effect
    void refreshSession()
  }, [checkHealth, refreshSession])

  useEffect(() => {
    if (sessionLoading || !session || (session.enabled && !session.authenticated)) return
    // Async initialization intentionally updates protected remote data after auth.
    // oxlint-disable-next-line react/set-state-in-effect
    void loadHistory(0, true)
    // Async initialization intentionally restores a shareable replay URL.
    // oxlint-disable-next-line react/set-state-in-effect
    const replayBattleId = readReplayBattleId()
    if (replayBattleId) void loadBattleDetail(replayBattleId)
    // oxlint-disable-next-line react/set-state-in-effect
    void loadSummary()
  }, [sessionLoading, session, loadHistory, loadBattleDetail, loadSummary])

  useEffect(() => {
    const restoreRoute = () => {
      const replayBattleId = readReplayBattleId()
      if (replayBattleId) void loadBattleDetail(replayBattleId)
      else setSelected(null)
    }
    window.addEventListener('popstate', restoreRoute)
    return () => window.removeEventListener('popstate', restoreRoute)
  }, [loadBattleDetail])

  const count = (battle: Battle | null, key: 'caught' | 'risks' | 'fixed') => battle?.defenderOut.reduce((total, result) => total + (result[key]?.length ?? 0), 0) ?? 0
  const totalPages = Math.max(1, Math.ceil(historyTotal / PAGE_SIZE))

  const openReplay = (battleId: string) => {
    const url = new URL(window.location.href)
    url.pathname = appBasePath()
    url.searchParams.set('battle_id', battleId)
    window.history.pushState({ battleId }, '', url.pathname + url.search)
    void loadBattleDetail(battleId)
  }

  const validateTopic = (value: string): string => {
    const trimmed = value.trim()
    if (!trimmed) return '请输入测试主题'
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
      const url = new URL(window.location.href)
      url.pathname = appBasePath()
      url.searchParams.delete('battle_id')
      window.history.replaceState({}, '', url.pathname + url.search)
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

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault()
    if (loginBusy || !loginPassword) return
    setLoginBusy(true)
    setLoginError('')
    try {
      const current = await loginBrowser(loginPassword)
      setSession(current)
      setLoginPassword('')
      if (!current.authenticated) setLoginError('登录未完成，请重试')
    } catch (error) {
      setLoginError('登录失败：' + apiErrorMessage(error))
    } finally {
      setLoginBusy(false)
    }
  }

  const submitLogout = async () => {
    try {
      const current = await logoutBrowser()
      setSession(current)
      setSelected(null)
      setBattles([])
      setSummary(null)
      setHistoryTotal(0)
      setMessage('已退出登录')
    } catch (error) {
      setMessage('退出登录失败：' + apiErrorMessage(error))
    }
  }

  const requiresLogin = Boolean(session?.enabled && !session.authenticated)

  if (sessionLoading || requiresLogin) {
    return <LoginPage
      status={status}
      onRetryHealth={() => void checkHealth()}
      onSubmit={submitLogin}
      password={loginPassword}
      onPasswordChange={setLoginPassword}
      busy={loginBusy}
      error={sessionLoading ? '' : loginError}
    />
  }

  return <div className="page">
    <header className="topbar"><div><div className="eyebrow">智能体攻防实验室（AGENT ATTACK LAB）</div><h1>智能体<em>攻防实验室</em></h1><p className="sub">后端联调控制台（Backend console） · 实时战局（Live battles） · 风险复盘（Risk review）</p></div><div className="topbar-actions">{session?.enabled && session.authenticated && <button className="btn-ghost auth-logout" type="button" onClick={() => void submitLogout()}>退出登录（Logout）</button>}<button className={'status ' + status} type="button" onClick={() => status === 'error' && void checkHealth()} disabled={status === 'loading'}><span className="dot" />{status === 'loading' ? '正在检查服务（Checking service）' : status === 'ok' ? '服务运行正常（Service healthy）' : '服务连接失败（Connection failed）· 点击重试（Retry）'}</button></div></header>
    <section className="stats" aria-label="真实统计口径（Persisted statistics）">{[
      ['已保存战局（Saved battles）', summary?.totalBattles ?? '—', '全部已保存战局数量', '#4da3ff'],
      ['规则库本地模拟用例（Rule cases）', summary?.ruleLibraryCaseCount ?? '—', '当前规则库中的唯一用例编号数', '#ffb54d'],
      ['已保存样本（Saved samples）', summary?.sampleCount ?? '—', '历史战局实际生成并保存的样本总数', '#3ddc97'],
      ['规则命中（Rule hits）', summary?.ruleHitCount ?? '—', '防守结果 caught 条目累计数', '#38c9ff'],
      ['风险记录（Risk records）', summary?.riskCount ?? '—', '防守结果 risks 条目累计数', '#ff5d6c'],
    ].map(([label, value, note, color]) => <div className="glass stat-card" style={{ '--ac': color } as React.CSSProperties} key={String(label)}><h3>{label}</h3><div className="stat-num">{value}</div><div className="stat-note">{note}</div></div>)}</section>
    <p className="stats-note">统计来自后端已保存战局。ACP 调用场次：{summary?.acpCallBattles ?? '—'}，表示至少一次成功调用了独立 ACP Agent；不代表真实目标已验证。规则库用例数是模板库规模，已保存样本数是历史战局产出，两者口径不同。{summary && summary.sampleCount === summary.ruleHitCount && summary.sampleCount === summary.riskCount ? '当前历史数据中三项恰好相同；它们分别汇总样本、caught 命中条目和 risks 风险条目，新增未命中样本后会按实际记录分开变化。' : ''}</p>
    <main className="layout"><div className="col-left">
      <section className="glass card"><div className="card-head"><div><div className="en">开始新战局（NEW BATTLE）</div><h2>开始新战局（New battle）</h2></div></div><form onSubmit={createBattle} noValidate><label htmlFor="topic">测试主题（Test topic）<input id="topic" className="input" value={topic} maxLength={200} aria-invalid={Boolean(topicError)} aria-describedby={topicError ? 'topic-error' : 'topic-count'} onChange={(event) => { const value = event.target.value; setTopic(value); if (topicError) setTopicError(validateTopic(value)) }} />{topicError ? <span className="field-error" id="topic-error" role="alert">{topicError}</span> : <span className="field-hint" id="topic-count">{topic.length}/200</span>}</label><label>对抗难度（Difficulty）<div className="diff-grid">{(['low', 'mid', 'high'] as Difficulty[]).map((item) => <label key={item}><input type="radio" name="difficulty" checked={difficulty === item} onChange={() => setDifficulty(item)} /><span className="diff-item"><b>{difficultyLabel[item]}</b><small>{item === 'low' ? '基础缺陷（Basic defect）' : item === 'mid' ? '规则违规（Rule violation）' : '复合漏洞（Compound vulnerability）'}</small></span></label>)}</div></label><button className="btn-primary" type="submit" disabled={busy}>{busy ? '攻防进行中（Battle running）...' : '开始攻防（Start battle）'}</button></form></section>
    <section className="glass card history"><div className="card-head"><div><div className="en">历史战局（BATTLE LOG）</div><h2>历史战局（Battle history）</h2></div><span className="en">{historyTotal} 场</span></div><input className="input" placeholder="搜索主题或编号（Search topic or ID）" value={search} onChange={(event) => { const value = event.target.value; setSearch(value); void loadHistory(0, false, value) }} />{historyLoading ? <div className="empty" role="status">正在加载历史战局（Loading battle history）...</div> : <div className="battle-list">{battles.length ? battles.map((battle) => <button className={'battle-item ' + (selected?.id === battle.id ? 'active' : '')} key={battle.id} onClick={() => openReplay(battle.id)}><span className={'battle-badge ' + battle.difficulty}>{difficultyLabel[battle.difficulty]}</span><span className="bi-main"><b>{battle.topic}</b><small>{new Date(battle.createdAt).toLocaleString('zh-CN')} · {displayLabel(battle.status)}</small></span><span className="arrow">›</span></button>) : <div className="empty">暂无匹配记录（No matching battles）</div>}</div>}<div className="pagination"><button type="button" className="btn-ghost" disabled={historyLoading || historyPage === 0} onClick={() => void loadHistory(historyPage - 1, false, search)}>上一页</button><span>第 {historyPage + 1} / {totalPages} 页 · 每页 {PAGE_SIZE} 场</span><button type="button" className="btn-ghost" disabled={historyLoading || historyPage + 1 >= totalPages} onClick={() => void loadHistory(historyPage + 1, false, search)}>下一页</button></div></section>
    </div>
    <section className="glass card detail">{selected ? <><div className="detail-head"><div><h2>{selected.topic}</h2><div className="detail-meta">{selected.id} · {difficultyLabel[selected.difficulty]}难度（Difficulty） · {displayLabel(selected.status)} · {new Date(selected.createdAt).toLocaleString('zh-CN')}</div><div className="source-meta"><span>攻击来源：{sourceLabel(selected.attackerOut.agentSource)}</span><span>防守来源：{sourceLabel(selected.defenderOut[0]?.agentSource)}</span></div></div><button className="btn-ghost" onClick={exportMarkdown}>导出 Markdown（Export Markdown）</button></div><div className="steps">{[['战局创建（Create battle）', '已完成（Completed）'], ['攻击生成（Generate attacks）', selected.attackerOut.samples.length + ' 个样本（samples）'], ['防守检测（Detect）', count(selected, 'caught') + ' 项发现（findings）'], ['修复建议（Remediate）', count(selected, 'fixed') + ' 项动作（actions）']].map(([title, sub], index) => <div className="step" key={title}><div className="n">{index + 1}</div><b>{title}</b><small>{sub}</small></div>)}</div><div className="rounds-head"><h3>逐轮对抗（Rounds） <small>ROUNDS</small></h3><span className="total">{selected.attackerOut.samples.length} rounds</span></div><div className="rounds-scroll">{selected.attackerOut.samples.map((sample, index) => { const defense = selected.defenderOut[index] ?? {}; return <article className="round-card" key={selected.id + '-' + index}><div className="round-head"><b>第 {index + 1} 轮（Round {index + 1}）</b><span className="pill">{sampleTypeLabel[sample.type] ?? sample.type} · {difficultyLabel[sample.severity as Difficulty] ?? sample.severity}</span><span className="state">已完成（Completed）</span></div><div className="round-body"><div className="side atk"><h4>攻击方 · 样本生成（Attacker · Sample generation）</h4><span className="code-chip">来源（Source）：{sourceLabel(selected.attackerOut.agentSource)}</span><span className="code-chip">主题（Topic）：{sample.topic ?? selected.topic}</span><div className="sample"><span className="sample-label">原始样本（Raw sample）</span>{sample.content}</div></div><div className="side def"><h4>防守方 · 检测与修复（Defender · Detection & remediation）</h4><span className="code-chip">来源（Source）：{sourceLabel(defense.agentSource)}</span><Finding label="发现问题（Findings）" items={defense.caught?.map((item) => displayLabel(item.reason ?? item.type)) ?? []} empty="未发现问题（No findings）" /><Finding label="风险评估（Risk assessment）" items={defense.risks?.map((item) => displayLabel(item.reason ?? item.level)) ?? []} empty="无额外风险（No additional risks）" /><Finding label="修复动作（Remediation）" items={defense.fixed?.map((item) => displayLabel(item.action ?? item.status)) ?? []} empty="无需修复（No remediation needed）" />{defense.scopeNotice && <div className="finding"><span className="k">范围说明（Scope）</span><span className="v">{defense.scopeNotice}</span></div>}</div></div></article> })}</div></> : <div className="empty detail-empty">提交主题后开始一轮攻防（Submit a topic to start），或选择历史战局查看详情（Select a battle to view details）。</div>}</section></main>{message && <div className="toast show">{message}</div>}
  </div>
}

function Finding({ label, items, empty }: { label: string; items: Array<string | undefined>; empty: string }) {
  return <div className="finding"><span className="k">{label}</span><span className="v">{items.filter(Boolean).join('；') || empty}</span></div>
}

export default App


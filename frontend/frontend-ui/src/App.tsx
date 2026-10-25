import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
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
const BattleScene = lazy(() => import('./BattleScene'))
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
  'local-rule': '规则引擎',
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
        setExternalCaseMessage('外部案例暂不可用')
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
      const created = await api<Battle>('/battles', { method: 'POST', body: JSON.stringify({ topic: topic.trim(), difficulty }) })
      let battle: Battle
      try {
        battle = await getBattle(created.id)
      } catch (error) {
        setMessage('创建请求已提交，但暂时无法回读战局详情：' + apiErrorMessage(error))
        return
      }
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

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const openExternalCases = () => {
    const cases = document.getElementById('external-cases') as HTMLDetailsElement | null
    if (cases) cases.open = true
    scrollToSection('external-cases')
  }

  return <div className="console-shell">
    <header className="console-topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">✦</span>
        <div><strong>智能体攻防实验室</strong><small>AGENT ATTACK LAB · COMMAND CENTER</small></div>
      </div>
      <nav aria-label="快捷功能">
        <button type="button" onClick={() => scrollToSection('score-data-row')} disabled={!selected}><span aria-hidden="true">◉</span>本局评分</button>
        <button type="button" onClick={openExternalCases}><span aria-hidden="true">▣</span>安全案例</button>
      </nav>
      <div className="console-topbar-actions">
        <a className="admin-link" href="/admin">管理员后台</a>
        <button className={'health ' + status} type="button" onClick={() => void checkHealth()} disabled={status === 'loading'}>
          <i aria-hidden="true" />{status === 'loading' ? '正在连接' : status === 'ok' ? '服务正常' : '连接失败 · 重试'}
        </button>
      </div>
    </header>

    <main className="layout console-main">
      <section className="video-layout" aria-label="攻防控制台">
        <section className="battle-visual-panel" aria-label="三维战场">
          <Suspense fallback={<div className="scene-loading" role="status">正在加载战场场景</div>}>
            <BattleScene battle={selected} />
          </Suspense>
          <div className="battle-session-bar" aria-label="当前战局信息">
            <div className="battle-session-info">
              <span className="session-item theme"><span>本局主题</span><b>{selected?.topic ?? '未选择战局'}</b></span>
              <span className="session-item"><span>编号 ID</span><b>{selected?.id ?? '—'}</b></span>
              <span className="session-item"><span>样本数</span><b>{selected?.attackerOut.samples.length ?? 0}</b></span>
              <span className="session-item"><span>难度</span><b>{selected ? difficultyLabel[selected.difficulty] : '未选择'}</b></span>
            </div>
          </div>
          <div className="battle-overlay" role="status">
            <span className={'stage ' + (selected?.status === 'running' ? 'running' : '')}>{selected ? displayLabel(selected.status) : '等待选择战局'}</span>
          </div>
          <div className="battle-hint">战场场景 · 数据以已保存战局为准</div>
        </section>

        <aside className="side-right" aria-label="战局控制面板">
          <section className="live-card" aria-label="当前战局">
            <div className="live-row"><span>编号</span><b>{selected?.id ?? '—'}</b></div>
            <div className="live-row"><span>难度</span><b>{selected ? difficultyLabel[selected.difficulty] : '未选择'}</b></div>
            <div className="live-theme">{selected ? selected.topic : '选择历史战局或创建新战局'}</div>
            <div className="live-row"><span>状态</span><b>{selected ? displayLabel(selected.status) : '等待战局'}</b></div>
            <div className="round-num">{selected?.attackerOut.samples.length ?? 0}<small> 已记录样本</small></div>
          </section>

          <section className="panel create-panel">
            <div className="panel-title"><span>新建战局</span><small>NEW BATTLE</small></div>
            <form onSubmit={createBattle} noValidate>
              <label htmlFor="topic">攻防主题</label>
              <input id="topic" className="input" value={topic} maxLength={200} aria-invalid={Boolean(topicError)} aria-describedby={topicError ? 'topic-error' : 'topic-count'} onChange={(event) => { const value = event.target.value; setTopic(value); if (topicError) setTopicError(validateTopic(value)) }} />
              <div className="field-line">{topicError ? <b id="topic-error" role="alert">{topicError}</b> : <span id="topic-count">输入本次测试主题</span>}<span>{topic.length}/200</span></div>
              <label>对抗难度</label>
              <div className="difficulty-control">{(['low', 'mid', 'high'] as Difficulty[]).map((item) => <label key={item}><input type="radio" name="difficulty" checked={difficulty === item} onChange={() => setDifficulty(item)} /><span><b>{difficultyLabel[item]}</b><small>{item === 'low' ? '基础缺陷' : item === 'mid' ? '规则违规' : '复合漏洞'}</small></span></label>)}</div>
              <p className="operation-notice">战局由后端执行并保存；结果仅反映本次安全评估数据，不访问外部目标。</p>
              <button className="primary" type="submit" disabled={busy}>{busy ? '战局处理中…' : '开始攻防'}</button>
            </form>
          </section>

          <section className="timeline" aria-label="已记录对抗轮次">
            <header className="tl-head"><div><h2>已记录对抗轮次</h2><small>{selected ? selected.attackerOut.samples.length + ' 个样本 · 读取自战局详情' : '选择战局后显示服务端返回内容'}</small></div><span className="live">{selected ? displayLabel(selected.status) : '等待选择'}</span></header>
            <div className="tl-body">
              {selected && selected.attackerOut.samples.length ? selected.attackerOut.samples.map((sample, index) => {
                const defense = selected.defenderOut[index] ?? {}
                const findingCount = (defense.caught?.length ?? 0) + (defense.risks?.length ?? 0) + (defense.fixed?.length ?? 0)
                return <article className="tl-round" key={selected.id + '-timeline-' + index}>
                  <div className="tl-round-head"><b>第 {index + 1} 轮</b><span>{sampleTypeLabel[sample.type] ?? sample.type} · {difficultyLabel[sample.severity as Difficulty] ?? sample.severity}</span></div>
                  <p>{sample.content}</p>
                  <div className="tl-round-foot"><span>防守记录 {findingCount} 项</span><span>{sourceLabel(defense.agentSource)}</span></div>
                </article>
              }) : <div className="tl-empty">{selected?.status === 'pending' || selected?.status === 'running' ? '战局处理中，等待后端返回样本与检测结果。' : '暂无已记录轮次。选择历史战局，或创建新战局后查看。'}</div>}
            </div>
          </section>
        </aside>
      </section>

      <section className="score-data-row" id="score-data-row" aria-label="内部运行质量评分">
        <div className="scoreboard-head"><div><span className="section-kicker">BATTLE SCORE</span><h2>内部运行质量评分</h2><p>仅展示后端评分接口返回的结果。</p></div><span className="score-status">{selected ? displayLabel(selected.status) : '暂无选中战局'}</span></div>
        {scoreLoading ? <div className="panel-empty" role="status">正在读取评分数据…</div>
          : battleScore ? <><p className="score-note">{battleScore.message || '分别衡量输出完整度与可审计性。'}</p><div className="score-grid"><ScoreRole title="攻击方" role={battleScore.attacker} /><ScoreRole title="防守方" role={battleScore.defender} /></div></>
            : scoreMessage ? <div className="panel-empty">{scoreMessage}</div>
              : <div className="panel-empty">{selected ? '当前战局暂无可展示的评分数据。' : '选择已完成战局查看评分。'}</div>}
      </section>

      <section className="history-split" aria-label="历史战局与详情">
        <section className="panel history">
          <div className="panel-title"><span>历史战局</span><small>BATTLE HISTORY · {historyTotal} 场</small></div>
          <label className="history-search"><span className="sr-only">搜索历史战局</span><input className="input" aria-label="搜索历史战局" placeholder="搜索主题或战局编号" value={search} onChange={(event) => { const value = event.target.value; setSearch(value); void loadHistory(0, false, value) }} /></label>
          {historyLoading ? <div className="panel-empty" role="status">正在加载历史战局…</div> : <div className="battle-list">{battles.length ? battles.map((battle) => <button className={'battle-item ' + (selected?.id === battle.id ? 'active' : '')} key={battle.id} onClick={() => openReplay(battle.id)}><span className={'battle-badge ' + battle.difficulty}>{difficultyLabel[battle.difficulty]}</span><span className="bi-main"><b>{battle.topic}</b><small>{new Date(battle.createdAt).toLocaleString('zh-CN')} · {displayLabel(battle.status)}</small></span><span className="arrow">›</span></button>) : <div className="panel-empty">暂无匹配记录</div>}</div>}
          <div className="pagination"><button type="button" className="btn-ghost" disabled={historyLoading || historyTotal === 0 || historyPage === 0} onClick={() => void loadHistory(historyPage - 1, false, search)}>上一页</button>{historyTotal > 0 && <span>第 {historyPage + 1} / {totalPages} 页 · 每页 {PAGE_SIZE} 场</span>}<button type="button" className="btn-ghost" disabled={historyLoading || historyTotal === 0 || historyPage + 1 >= totalPages} onClick={() => void loadHistory(historyPage + 1, false, search)}>下一页</button></div>
        </section>

        <section className="panel detail" id="battle-detail">
          {selected ? <>
            <div className="detail-head"><div><h2>{selected.topic}</h2><div className="detail-meta">{selected.id} · {difficultyLabel[selected.difficulty]}难度 · {displayLabel(selected.status)} · {new Date(selected.createdAt).toLocaleString('zh-CN')}</div><div className="source-meta"><span>攻击来源：{sourceLabel(selected.attackerOut.agentSource)}</span><span>防守来源：{sourceLabel(selected.defenderOut[0]?.agentSource)}</span></div></div><div className="detail-actions"><button className="btn-ghost" type="button" onClick={exportMarkdown}>导出 Markdown</button>{selected.status === 'failed' && <button className="btn-ghost" type="button" disabled={actionBusy} onClick={() => void handleRetryBattle()}>重试失败战局</button>}{(selected.status === 'completed' || selected.status === 'failed') && <button className="btn-danger" type="button" disabled={actionBusy} onClick={() => void handleDeleteBattle()}>删除战局</button>}</div></div>
            <div className="steps">{[['战局创建', displayLabel(selected.status)], ['攻击生成', selected.attackerOut.samples.length + ' 个样本'], ['防守检测', count(selected, 'caught') + ' 项发现'], ['修复建议', count(selected, 'fixed') + ' 项动作']].map(([title, sub], index) => <div className="step" key={title}><div className="n">{index + 1}</div><b>{title}</b><small>{sub}</small></div>)}</div>
            <div className="rounds-head"><h3>逐轮对抗记录</h3><span className="total">{selected.attackerOut.samples.length} 轮</span></div>
            <div className="rounds-scroll">{selected.attackerOut.samples.length ? selected.attackerOut.samples.map((sample, index) => { const defense = selected.defenderOut[index] ?? {}; return <article className="round-card" key={selected.id + '-' + index}><div className="round-head"><b>第 {index + 1} 轮</b><span className="pill">{sampleTypeLabel[sample.type] ?? sample.type} · {difficultyLabel[sample.severity as Difficulty] ?? sample.severity}</span><span className="state">{displayLabel(selected.status)}</span></div><div className="round-body"><div className="side atk"><h4>攻击方 · 样本</h4><span className="code-chip">来源：{sourceLabel(selected.attackerOut.agentSource)}</span><span className="code-chip">主题：{sample.topic ?? selected.topic}</span><div className="sample"><span className="sample-label">样本内容</span>{sample.content}</div></div><div className="side def"><h4>防守方 · 已记录结果</h4><span className="code-chip">来源：{sourceLabel(defense.agentSource)}</span><Finding label="发现问题" items={defense.caught?.map((item) => displayLabel(item.reason ?? item.type)) ?? []} empty="暂无记录" /><Finding label="风险评估" items={defense.risks?.map((item) => displayLabel(item.reason ?? item.level)) ?? []} empty="暂无记录" /><Finding label="修复动作" items={defense.fixed?.map((item) => displayLabel(item.action ?? item.status)) ?? []} empty="暂无记录" />{defense.scopeNotice && <div className="finding"><span className="k">范围说明</span><span className="v">{defense.scopeNotice}</span></div>}</div></div></article> }) : <div className="panel-empty">{selected.status === 'pending' || selected.status === 'running' ? '攻防进行中，等待样本与结果…' : '本场暂无对抗轮次'}</div>}</div>
          </> : <div className="detail-empty"><span>选择战局查看详情</span><p>从左侧历史列表选择，或创建一场新战局。</p></div>}
        </section>
      </section>
    </main>

    {selected?.attackerOut.samples.some((sample) => sample.simulation === true) && <p className="sample-scope-note">安全评估样本 · 未访问真实外部目标。</p>}
    <section className="stats" aria-label="真实统计口径（Persisted statistics）">{[
      ['已保存战局', summary?.totalBattles ?? '—', '全部已保存战局数量', '#4da3ff'],
      ['规则库条目', summary?.ruleLibraryCaseCount ?? '—', '规则库中唯一编号的条目数', '#ffb54d'],
      ['已保存样本', summary?.sampleCount ?? '—', '历史战局实际生成并保存的样本总数', '#3ddc97'],
      ['规则命中', summary?.ruleHitCount ?? '—', '防守结果 caught 条目累计数', '#38c9ff'],
      ['风险记录', summary?.riskCount ?? '—', '防守结果 risks 条目累计数', '#ff5d6c'],
    ].map(([label, value, note, color]) => <div className="glass stat-card" style={{ '--ac': color } as React.CSSProperties} key={String(label)}><h3>{label}</h3><div className="stat-num">{value}</div><div className="stat-note">{note}</div></div>)}</section>
    <p className="stats-note">统计来自后端已保存战局。ACP 调用场次：{summary?.acpCallBattles ?? '—'}，表示至少一次成功调用独立 ACP Agent；不代表真实目标已验证。规则库用例与已保存样本采用不同统计口径。</p>
    <details className="glass card external-cases" id="external-cases" aria-label="外部安全案例库（External case references）"><summary className="external-cases-summary"><div className="card-head"><div><div className="en">EXTERNAL CASES</div><h2>外部安全案例库</h2></div><span className="en">{externalCaseTotal} 条 · {externalCaseSources} 个来源</span></div></summary><div className="external-cases-content"><div className="external-toolbar"><input className="input" aria-label="搜索外部案例" placeholder="搜索 CVE、标题、厂商或产品" value={externalCaseSearch} onChange={(event) => setExternalCaseSearch(event.target.value)} /><button className="btn-ghost" type="button" onClick={() => void loadExternalCases(externalCaseSearch)} disabled={externalCaseLoading}>查询</button></div>{externalCaseLoading ? <div className="panel-empty" role="status">正在加载外部案例…</div> : externalCaseMessage ? <div className="panel-empty">{externalCaseMessage}</div> : externalCases.length ? <div className="external-case-list">{externalCases.map((item) => <article className="external-case" key={item.externalId}><div className="external-case-head"><strong>{item.externalId}</strong><span>{item.provenanceStatus} · {item.recordKind}</span></div><h3>{item.title}</h3><p className="external-case-meta">{item.vendorProject} · {item.product} · 加入目录 {item.dateAdded}</p><p>{item.description}</p><div className="external-case-source">来源：{item.source.publisher} · 目录 {item.source.catalogVersion} · <a href={item.sourceUrl} target="_blank" rel="noreferrer">查看原始来源</a><span title={item.source.contentSha256}> · SHA-256 {item.source.contentSha256.slice(0, 12)}…</span></div></article>)}</div> : <div className="panel-empty">暂无匹配案例</div>}</div></details>
    {message && <div className="toast show" role="status">{message}</div>}
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


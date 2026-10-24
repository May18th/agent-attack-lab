import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './AdminApp.css'
import {
  apiErrorMessage, cancelAdminBattle, deleteAdminBattle, getAdminBattleAudit, getAdminBattleDetail,
  getAdminBattleEvents, getAdminBattleScore, getAdminDashboardSummary, getAdminExternalCases, getAdminMetrics,
  getAdminReport, getAdminSession, listAdminBattles, loginAdminSession, logoutAdminSession, retryAdminBattle,
  type AdminBattle, type AdminBattleEvent, type AdminBattleListFilters, type AdminBattleScore, type AdminExternalCases,
} from './adminApi'
import { AdminManagementPanel } from './AdminManagementPanel'
import { ApiError } from './api'
import { BattleTimeline3D } from './admin3d/BattleTimeline3D'

const Admin3DWorkspace = lazy(() => import('./admin3d/Admin3DWorkspace').then((module) => ({ default: module.Admin3DWorkspace })))

const PAGE_SIZE = 10
const statusLabels: Record<string, string> = { pending: '等待中', running: '进行中', completed: '已完成', failed: '失败' }
const difficultyLabels: Record<string, string> = { low: '低', mid: '中', high: '高' }
const metricLabels: Record<string, string> = {
  totalBattles: '总战局', completedBattles: '已完成', failedBattles: '失败', highDifficultyBattles: '高难度战局',
  sampleCount: '攻击样本', ruleHitCount: '规则命中', riskCount: '风险项', recommendationCount: '防守建议',
  uptimeSeconds: '运行时长（秒）', requests: '累计请求', errors: '错误数', averageLatencyMs: '平均延迟（毫秒）',
  maxLatencyMs: '最大延迟（毫秒）', rate_limited: '限流请求', rateLimitPerMinute: '每分钟请求上限',
  eventDataMaxBytes: '事件数据上限（字节）', recoveryTasks: '恢复任务', activeBattleTasks: '活跃战局任务',
}
const label = (value?: string, labels: Record<string, string> = statusLabels) => value ? labels[value] ?? value : '暂无'
const metricLabel = (key: string) => metricLabels[key] ?? key
const jsonPreview = (value: unknown) => JSON.stringify(value ?? {}, null, 2)

function SecurityLockIcon() {
  return <svg className="security-lock" role="img" aria-label="安全登录" viewBox="0 0 24 24" fill="none" aria-hidden="false"><path d="M7.5 10V7.75a4.5 4.5 0 0 1 9 0V10" /><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M12 14v2" /></svg>
}

function HolographicNetwork() {
  return <div className="holo-network" role="img" aria-label="全息网络拓扑"><svg viewBox="0 0 600 500" fill="none" aria-hidden="true"><defs><pattern id="shield-dots" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r=".8" fill="#75a8cc" opacity=".42" /></pattern></defs><path className="holo-grid" d="M108 370 204 132l184 44 106 116M108 370l188 76 198-154M204 132l92 314M388 176l12 164 94 46" /><path className="holo-link" d="m108 370 188-142 92-52 106 116M204 132l92 96 198 24M296 446l-2-218" /><path className="holo-link holo-link-delayed" d="m108 370 186-142 2 218m198-244 106 116-12 14" /><circle className="holo-node holo-node-large" cx="296" cy="228" r="12" /><circle className="holo-node" cx="108" cy="370" r="7" /><circle className="holo-node" cx="204" cy="132" r="7" /><circle className="holo-node" cx="388" cy="176" r="7" /><circle className="holo-node" cx="494" cy="292" r="7" /><circle className="holo-node" cx="296" cy="446" r="7" /><circle className="holo-node" cx="400" cy="340" r="7" /><circle className="shield-ring" cx="296" cy="270" r="108" /><circle className="shield-ring" cx="296" cy="270" r="132" /><path className="holo-shield" d="M296 178 364 206v62c0 56-34 96-68 116-34-20-68-60-68-116v-62l68-28Z" /><path className="holo-shield-data" d="M244 238h104M244 252h104M250 266h92M258 280h76M268 294h56" /><path className="holo-shield-line" d="m263 263 23 23 45-52" /><path className="holo-shield-sweep" d="M228 214h136" /><g className="holo-server"><path d="m410 264 44 13v47l-44-14v-46Zm44 13 34-16v46l-34 17v-47Zm-44-13 34-17 44 14-34 16-44-13Z" /><path d="M422 282h8m-8 13h8m30-26 14-6m-14 20 14-6" /></g><g className="holo-key"><circle cx="166" cy="276" r="11" /><path d="m174 284 26 26m-8-8 8-8m-1 17 8-8" /></g><path className="holo-data-line" d="M184 276h56m196 26h40" /></svg><span className="data-stream stream-one" /><span className="data-stream stream-two" /><span className="data-stream stream-three" /></div>
}

function AuthFrame({ children }: { children: React.ReactNode }) {
  return <main className="admin-shell auth-shell"><HolographicNetwork /><section className="admin-auth auth-card"><span className="auth-border-sweep" aria-hidden="true" />{children}</section></main>
}

function errorText(error: unknown): string {
  const message = apiErrorMessage(error)
  const requestId = error instanceof ApiError ? error.requestId : undefined
  return requestId ? `${message}（请求 ID：${requestId}）` : message
}

export default function AdminApp() {
  const [session, setSession] = useState<{ enabled: boolean; authenticated: boolean } | null>(null)
  const [sessionError, setSessionError] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginBusy, setLoginBusy] = useState(false)
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null)
  const [metrics, setMetrics] = useState<Record<string, unknown> | null>(null)
  const [battles, setBattles] = useState<AdminBattle[]>([])
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<AdminBattle | null>(null)
  const [detailData, setDetailData] = useState<Record<string, unknown>>({})
  const [selectedTimelineEvent, setSelectedTimelineEvent] = useState<AdminBattleEvent | null>(null)
  const [timelineQuery, setTimelineQuery] = useState('')
  const [eventPageInfo, setEventPageInfo] = useState({ total: 0, hasMore: false })
  const [cases, setCases] = useState<AdminExternalCases | null>(null)
  const [caseQuery, setCaseQuery] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const detailRequestId = useRef(0)
  const selectedBattleRef = useRef(selected)

  const checkSession = useCallback(async () => {
    setSessionError('')
    try { setSession(await getAdminSession()) } catch (e) { setSession(null); setSessionError(errorText(e)) }
  }, [])
  const handleLogout = useCallback(async () => {
    setError('')
    try {
      await logoutAdminSession()
      window.location.href = '/'
    } catch (e) { setError(errorText(e)) }

  }, [])
  const handlePasswordLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoginBusy(true)
    setSessionError('')
    try {
      await loginAdminSession(loginPassword)
      setLoginPassword('')
      await checkSession()
    } catch (e) {
      setSessionError(errorText(e))
    } finally {
      setLoginBusy(false)
    }
  }
  useEffect(() => { queueMicrotask(() => void checkSession()) }, [checkSession])

  const loadList = useCallback(async (filters?: Partial<AdminBattleListFilters>) => {
    setLoading(true)
    try {
      const result = await listAdminBattles({ limit: PAGE_SIZE, offset: page * PAGE_SIZE, q: query, status, ...filters })
      setBattles(Array.isArray(result?.items) ? result.items : [])
      setTotal(Number(result?.total) || 0)
    } catch (e) { setBattles([]); setTotal(0); setError(errorText(e)) } finally { setLoading(false) }
  }, [page, query, status])

  const loadOverview = useCallback(async () => {
    const [sum, met] = await Promise.allSettled([getAdminDashboardSummary(), getAdminMetrics()])
    if (sum.status === 'fulfilled') setSummary(sum.value as Record<string, unknown>)
    if (met.status === 'fulfilled') setMetrics(met.value)
    const failed = [sum, met].find((item) => item.status === 'rejected')
    if (failed?.status === 'rejected') setError(errorText(failed.reason))
  }, [])

  const loadCases = useCallback(async (q = caseQuery) => {
    try { setCases(await getAdminExternalCases({ limit: 20, q })) } catch (e) { setError(errorText(e)) }
  }, [caseQuery])
  useEffect(() => {
    if (!session || (session.enabled && !session.authenticated)) return
    queueMicrotask(() => { void loadOverview(); void loadList(); void loadCases('') })
  }, [session, loadOverview, loadList, loadCases])

  const loadBattleDetails = useCallback(async (battle: AdminBattle, select = false) => {
    const requestId = ++detailRequestId.current
    if (select) { setSelected(battle); setDetailData({}); setSelectedTimelineEvent(null); setTimelineQuery(''); setEventPageInfo({ total: 0, hasMore: false }) }
    const entries = await Promise.allSettled([
      getAdminBattleDetail(battle.id), getAdminBattleScore(battle.id), getAdminBattleEvents(battle.id),
      getAdminBattleAudit(battle.id), getAdminReport(battle.id),
    ])
    const names = ['详情', '评分', '事件页', '审计', '报告']
    const data: Record<string, unknown> = {}
    entries.forEach((entry, index) => { if (entry.status === 'fulfilled') data[names[index]] = entry.value })
    if (requestId !== detailRequestId.current) return
    const eventPage = data['事件页'] as Awaited<ReturnType<typeof getAdminBattleEvents>> | undefined
    if (eventPage) {
      data['事件'] = eventPage.items
      setEventPageInfo({ total: eventPage.total, hasMore: eventPage.hasMore })
    }
    delete data['事件页']
    setDetailData(data)
    const latestBattle = data['详情'] as AdminBattle | undefined
    if (!select && latestBattle?.id === battle.id) setSelected((current) => current?.id === battle.id ? { ...current, ...latestBattle } : current)
    const failed = entries.find((item) => item.status === 'rejected')
    if (requestId === detailRequestId.current && failed?.status === 'rejected') setError(errorText(failed.reason))
  }, [])
  const selectBattle = useCallback((battle: AdminBattle) => loadBattleDetails(battle, true), [loadBattleDetails])

  const loadMoreEvents = useCallback(async () => {
    const battleId = selected?.id
    const currentEvents = detailData['事件'] as AdminBattleEvent[] | undefined
    const afterSequence = currentEvents?.at(-1)?.sequence ?? 0
    if (!battleId || !eventPageInfo.hasMore) return
    const requestId = detailRequestId.current
    try {
      const nextPage = await getAdminBattleEvents(battleId, afterSequence)
      if (requestId !== detailRequestId.current) return
      setDetailData((current) => ({ ...current, '事件': [...(current['事件'] as AdminBattleEvent[] ?? []), ...nextPage.items] }))
      setEventPageInfo({ total: nextPage.total, hasMore: nextPage.hasMore })
    } catch (e) { setError(errorText(e)) }
  }, [detailData, eventPageInfo.hasMore, selected])

  const selectedBattleId = selected?.id
  const selectedBattleStatus = selected?.status
  useEffect(() => { selectedBattleRef.current = selected }, [selected])
  useEffect(() => {
    if (!selectedBattleId || (selectedBattleStatus !== 'pending' && selectedBattleStatus !== 'running')) return
    let timer: number | undefined
    let disposed = false
    let refreshing = false
    const clearPoll = () => { if (timer !== undefined) { window.clearInterval(timer); timer = undefined } }
    const refreshSelected = (force = false) => {
      if (disposed || document.visibilityState !== 'visible' || (refreshing && !force)) return
      const currentBattle = selectedBattleRef.current
      if (!currentBattle || currentBattle.id !== selectedBattleId) return
      refreshing = true
      void loadBattleDetails(currentBattle).finally(() => { refreshing = false })
    }
    const startPoll = () => {
      clearPoll()
      if (!disposed && document.visibilityState === 'visible') timer = window.setInterval(refreshSelected, 15_000)
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') { refreshSelected(true); startPoll() }
      else clearPoll()
    }
    startPoll()
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      disposed = true
      clearPoll()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [selectedBattleId, selectedBattleStatus, loadBattleDetails])

  const refresh = async (reloadSelected = true) => { await Promise.all([loadList(), loadOverview()]); if (reloadSelected && selected) await selectBattle(selected) }
  const handleBattleCreated = useCallback((battle: AdminBattle) => {
    setSelected(battle)
    void refresh(false)
    void selectBattle(battle)
  }, [refresh, selectBattle])
  const runAction = async (action: 'retry' | 'cancel' | 'delete') => {
    if (!selected || busy) return
    const question = action === 'delete' ? '确认删除该战局？删除后不可恢复。' : action === 'cancel' ? '确认取消该战局？' : '确认重试该失败战局？'
    if (!window.confirm(question)) return
    setBusy(true); setError('')
    try {
      let updatedBattle: AdminBattle | undefined
      if (action === 'retry') updatedBattle = await retryAdminBattle(selected.id)
      if (action === 'cancel') updatedBattle = await cancelAdminBattle(selected.id)
      if (action === 'delete') { await deleteAdminBattle(selected.id); detailRequestId.current += 1; setSelected(null); setDetailData({}) }
      await refresh(false)
      if (updatedBattle) { setSelected(updatedBattle); await selectBattle(updatedBattle) }
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const overviewItems = useMemo(() => Object.entries(summary ?? {}).filter(([, value]) => typeof value === 'number').slice(0, 8), [summary])
  if (!session) return <AuthFrame><div className="auth-mark"><SecurityLockIcon /><span>安全会话</span></div><h1>管理员后台 - 会话检查</h1><p className="auth-description">正在验证当前访问凭据，请稍候。</p>{sessionError && <p className="admin-error" role="alert">{sessionError}</p>}<button className="auth-secondary" onClick={() => void checkSession()}>重新检查会话</button></AuthFrame>
  if (session.enabled && !session.authenticated) return <AuthFrame><div className="auth-mark"><SecurityLockIcon /><span>安全会话</span></div><h1>管理员后台 - 管理员认证</h1><p className="auth-description">使用后台管理密码建立安全会话。</p><form onSubmit={(event) => void handlePasswordLogin(event)}><label htmlFor="admin-login-password">后台管理密码</label><input id="admin-login-password" type="password" autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} required maxLength={256} disabled={loginBusy} /><button className="auth-primary" type="submit" disabled={loginBusy} aria-busy={loginBusy}>{loginBusy ? '登录中…' : '登录管理后台'}</button></form>{sessionError && <p className="admin-error" role="alert">{sessionError}</p>}<button className="auth-secondary" type="button" onClick={() => void checkSession()} disabled={loginBusy}>我已完成认证，重新检查</button></AuthFrame>

  return <main className="admin-shell">
    <header className="admin-header"><div><span className="admin-kicker">AGENT ATTACK LAB / OPERATIONS</span><h1>管理员后台</h1></div><button onClick={() => void handleLogout()}>退出会话</button></header>
    {error && <div className="admin-error" role="alert">{error}</div>}
    <Suspense fallback={<section className="admin3d-workspace" aria-live="polite">正在加载 3D 工作台…</section>}>
      <Admin3DWorkspace
        battles={battles}
        selectedBattle={selected}
        events={Array.isArray(detailData['事件']) ? detailData['事件'] as AdminBattleEvent[] : []}
        eventsTotal={eventPageInfo.total}
        hasMoreEvents={eventPageInfo.hasMore}
        onLoadMoreEvents={() => void loadMoreEvents()}
        selectedEvent={selectedTimelineEvent}
        score={detailData['评分'] as AdminBattleScore | null | undefined}
        eventQuery={timelineQuery}
        externalCases={cases?.available ? cases.items : []}
        onSelectBattle={selectBattle}
        onSelectEvent={setSelectedTimelineEvent}
      />
    </Suspense>
    <div id="admin-2d-workspace" className="admin-2d-workspace">
    <AdminManagementPanel battles={battles} onBattleCreated={handleBattleCreated} onError={setError} />
    <section className="admin-module metrics"><h2>运行指标</h2><div className="metric-grid">{overviewItems.length ? overviewItems.map(([key, value]) => <div className="metric" key={key}><span>{metricLabel(key)}</span><strong>{String(value)}</strong></div>) : <div className="empty">暂无指标</div>}</div><details className="admin-raw-metrics"><summary>原始指标数据</summary><pre className="data-preview" aria-label="态势数据">{jsonPreview(metrics)}</pre></details></section>
    <section className="admin-module"><div className="module-head"><h2>战局列表</h2><span>{total} 场</span></div><div className="filters"><input aria-label="搜索战局" placeholder="搜索主题或编号" value={query} onChange={(e) => { const value = e.target.value; setQuery(value); setPage(0); void loadList({ offset: 0, q: value }) }} onKeyDown={(e) => { if (e.key === 'Enter') void loadList({ offset: 0, q: query }) }} /><select aria-label="状态筛选" value={status} onChange={(e) => { const value = e.target.value; setStatus(value); setPage(0); void loadList({ offset: 0, status: value }) }}><option value="">全部状态</option>{Object.entries(statusLabels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select><button onClick={() => void loadList({ offset: 0 })}>查询</button></div>{loading ? <p>正在加载战局…</p> : <div className="battle-table">{battles.length ? battles.map((battle) => <button className="battle-row" key={battle.id} aria-label={`查看${battle.topic}`} onClick={() => void selectBattle(battle)}><span>{battle.topic || '未命名战局'}</span><span>{label(battle.status)} · {label(battle.difficulty, difficultyLabels)}</span><span>{battle.id}</span></button>) : <p className="empty">暂无战局</p>}</div>}<div className="pagination"><button disabled={page <= 0} onClick={() => { setPage(page - 1); void loadList({ offset: (page - 1) * PAGE_SIZE }) }}>上一页</button><span>第 {page + 1} / {pages} 页</span><button disabled={page + 1 >= pages} onClick={() => { setPage(page + 1); void loadList({ offset: (page + 1) * PAGE_SIZE }) }}>下一页</button></div></section>
    <section className="admin-module"><div className="module-head"><h2>战局详情</h2>{selected && <span>{selected.id}</span>}</div>{selected ? <><div className="detail-summary"><strong>{selected.topic || '未命名战局'}</strong><span>{label(selected.status)} · {label(selected.difficulty, difficultyLabels)}</span><div className="actions">{selected.status === 'failed' && <button disabled={busy} onClick={() => void runAction('retry')}>重试战局</button>}{(selected.status === 'pending' || selected.status === 'running') && <button disabled={busy} onClick={() => void runAction('cancel')}>取消战局</button>}{(selected.status === 'completed' || selected.status === 'failed') && <button className="danger" disabled={busy} onClick={() => void runAction('delete')}>删除战局</button>}</div></div><div className="detail-grid">{Object.entries(detailData).filter(([key]) => key !== '事件').map(([key, value]) => <details open key={key}><summary>{key}</summary><pre className="data-preview">{jsonPreview(value)}</pre></details>)}</div><BattleTimeline3D battle={selected} events={Array.isArray(detailData['事件']) ? detailData['事件'] as AdminBattleEvent[] : []} eventsTotal={eventPageInfo.total} hasMoreEvents={eventPageInfo.hasMore} onLoadMoreEvents={() => void loadMoreEvents()} audit={detailData['审计'] && typeof detailData['审计'] === 'object' ? detailData['审计'] as Record<string, unknown> : {}} score={detailData['评分'] as AdminBattleScore | null | undefined} selectedEvent={selectedTimelineEvent} onSearchQueryChange={setTimelineQuery} onSelectEvent={setSelectedTimelineEvent} /><span className="sr-only" aria-live="polite">{selectedTimelineEvent ? `当前选择事件 ${selectedTimelineEvent.sequence ?? ''} ${selectedTimelineEvent.type ?? selectedTimelineEvent.eventType ?? ''}` : ''}</span></> : <p className="empty">选择战局查看详情、评分、事件、审计和报告。</p>}</section>
    <section className="admin-module"><div className="module-head"><h2>外部案例</h2><span>只读</span></div><div className="filters"><input aria-label="搜索外部案例" placeholder="搜索 CVE、厂商或产品" value={caseQuery} onChange={(e) => setCaseQuery(e.target.value)} /><button onClick={() => void loadCases()}>查询</button></div>{cases?.available === false ? <p className="empty">{cases.reason || '外部案例不可用'}</p> : cases?.items?.length ? <div className="case-list">{cases.items.map((item) => <article key={item.externalId}><strong>{item.externalId} · {item.title}</strong><p>{item.vendorProject} · {item.product} · {item.provenanceStatus}</p><a href={item.sourceUrl} target="_blank" rel="noreferrer">来源</a></article>)}</div> : <p className="empty">暂无匹配案例</p>}</section>
    </div>
  </main>
}

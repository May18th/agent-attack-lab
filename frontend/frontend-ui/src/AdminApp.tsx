import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './AdminApp.css'
import {
  apiErrorMessage, cancelAdminBattle, deleteAdminBattle, getAdminBattleAudit, getAdminBattleDetail,
  getAdminBattleEvents, getAdminBattleScore, getAdminDashboardSummary, getAdminExternalCases, getAdminMetrics,
  getAdminReport, getAdminSession, listAdminBattles, logoutAdminSession, retryAdminBattle,
  type AdminBattle, type AdminBattleEvent, type AdminBattleListFilters, type AdminExternalCases,
} from './adminApi'
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

function errorText(error: unknown): string {
  const message = apiErrorMessage(error)
  const requestId = error instanceof ApiError ? error.requestId : undefined
  return requestId ? `${message}（请求 ID：${requestId}）` : message
}

export default function AdminApp() {
  const [session, setSession] = useState<{ enabled: boolean; authenticated: boolean } | null>(null)
  const [sessionError, setSessionError] = useState('')
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
  const [eventPageInfo, setEventPageInfo] = useState({ total: 0, hasMore: false })
  const [loadingMoreEvents, setLoadingMoreEvents] = useState(false)
  const [cases, setCases] = useState<AdminExternalCases | null>(null)
  const [caseQuery, setCaseQuery] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const detailRequestId = useRef(0)
  const loadingMoreEventsRef = useRef(false)
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
    if (select) { setSelected(battle); setDetailData({}); setSelectedTimelineEvent(null); setEventPageInfo({ total: 0, hasMore: false }); loadingMoreEventsRef.current = false; setLoadingMoreEvents(false) }
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
    if (!battleId || !eventPageInfo.hasMore || loadingMoreEventsRef.current) return
    const requestId = detailRequestId.current
    loadingMoreEventsRef.current = true
    setLoadingMoreEvents(true)
    try {
      const nextPage = await getAdminBattleEvents(battleId, afterSequence)
      if (requestId !== detailRequestId.current) return
      setDetailData((current) => ({ ...current, '事件': [...(current['事件'] as AdminBattleEvent[] ?? []), ...nextPage.items] }))
      setEventPageInfo({ total: nextPage.total, hasMore: nextPage.hasMore })
    } catch (e) { setError(errorText(e)) }
    finally { loadingMoreEventsRef.current = false; setLoadingMoreEvents(false) }
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
  if (!session) return <main className="admin-shell"><header className="admin-header"><h1>管理员后台</h1></header><section className="admin-auth"><h2>正在检查后台会话</h2>{sessionError && <p className="admin-error">{sessionError}</p>}<button onClick={() => void checkSession()}>重新检查会话</button></section></main>
  if (session.enabled && !session.authenticated) return <main className="admin-shell"><header className="admin-header"><h1>管理员后台</h1></header><section className="admin-auth"><h2>需要 Cloudflare Access 认证</h2><p>请在当前浏览器完成 Cloudflare Access 组织认证。认证由浏览器会话处理，后台不会收集密码。</p>{sessionError && <p className="admin-error">{sessionError}</p>}<button onClick={() => void checkSession()}>我已完成认证，重新检查</button></section></main>

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
        loadingMoreEvents={loadingMoreEvents}
        onLoadMoreEvents={() => void loadMoreEvents()}
        selectedEvent={selectedTimelineEvent}
        onSelectBattle={selectBattle}
        onSelectEvent={setSelectedTimelineEvent}
      />
    </Suspense>
    <div id="admin-2d-workspace" className="admin-2d-workspace">
    <section className="admin-module metrics"><h2>运行指标</h2><div className="metric-grid">{overviewItems.length ? overviewItems.map(([key, value]) => <div className="metric" key={key}><span>{metricLabel(key)}</span><strong>{String(value)}</strong></div>) : <div className="empty">暂无指标</div>}</div><details className="admin-raw-metrics"><summary>原始指标数据</summary><pre className="data-preview" aria-label="态势数据">{jsonPreview(metrics)}</pre></details></section>
    <section className="admin-module"><div className="module-head"><h2>战局列表</h2><span>{total} 场</span></div><div className="filters"><input aria-label="搜索战局" placeholder="搜索主题或编号" value={query} onChange={(e) => { const value = e.target.value; setQuery(value); setPage(0); void loadList({ offset: 0, q: value }) }} onKeyDown={(e) => { if (e.key === 'Enter') void loadList({ offset: 0, q: query }) }} /><select aria-label="状态筛选" value={status} onChange={(e) => { const value = e.target.value; setStatus(value); setPage(0); void loadList({ offset: 0, status: value }) }}><option value="">全部状态</option>{Object.entries(statusLabels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select><button onClick={() => void loadList({ offset: 0 })}>查询</button></div>{loading ? <p>正在加载战局…</p> : <div className="battle-table">{battles.length ? battles.map((battle) => <button className="battle-row" key={battle.id} aria-label={`查看${battle.topic}`} onClick={() => void selectBattle(battle)}><span>{battle.topic || '未命名战局'}</span><span>{label(battle.status)} · {label(battle.difficulty, difficultyLabels)}</span><span>{battle.id}</span></button>) : <p className="empty">暂无战局</p>}</div>}<div className="pagination"><button disabled={page <= 0} onClick={() => { setPage(page - 1); void loadList({ offset: (page - 1) * PAGE_SIZE }) }}>上一页</button><span>第 {page + 1} / {pages} 页</span><button disabled={page + 1 >= pages} onClick={() => { setPage(page + 1); void loadList({ offset: (page + 1) * PAGE_SIZE }) }}>下一页</button></div></section>
    <section className="admin-module"><div className="module-head"><h2>战局详情</h2>{selected && <span>{selected.id}</span>}</div>{selected ? <><div className="detail-summary"><strong>{selected.topic || '未命名战局'}</strong><span>{label(selected.status)} · {label(selected.difficulty, difficultyLabels)}</span><div className="actions">{selected.status === 'failed' && <button disabled={busy} onClick={() => void runAction('retry')}>重试战局</button>}{(selected.status === 'pending' || selected.status === 'running') && <button disabled={busy} onClick={() => void runAction('cancel')}>取消战局</button>}{(selected.status === 'completed' || selected.status === 'failed') && <button className="danger" disabled={busy} onClick={() => void runAction('delete')}>删除战局</button>}</div></div><div className="detail-grid">{Object.entries(detailData).filter(([key]) => key !== '事件').map(([key, value]) => <details open key={key}><summary>{key}</summary><pre className="data-preview">{jsonPreview(value)}</pre></details>)}</div><BattleTimeline3D battle={selected} events={Array.isArray(detailData['事件']) ? detailData['事件'] as AdminBattleEvent[] : []} eventsTotal={eventPageInfo.total} hasMoreEvents={eventPageInfo.hasMore} loadingMoreEvents={loadingMoreEvents} onLoadMoreEvents={() => void loadMoreEvents()} audit={detailData['审计'] && typeof detailData['审计'] === 'object' ? detailData['审计'] as Record<string, unknown> : {}} selectedEvent={selectedTimelineEvent} onSelectEvent={setSelectedTimelineEvent} /><span className="sr-only" aria-live="polite">{selectedTimelineEvent ? `当前选择事件 ${selectedTimelineEvent.sequence ?? ''} ${selectedTimelineEvent.type ?? selectedTimelineEvent.eventType ?? ''}` : ''}</span></> : <p className="empty">选择战局查看详情、评分、事件、审计和报告。</p>}</section>
    <section className="admin-module"><div className="module-head"><h2>外部案例</h2><span>只读</span></div><div className="filters"><input aria-label="搜索外部案例" placeholder="搜索 CVE、厂商或产品" value={caseQuery} onChange={(e) => setCaseQuery(e.target.value)} /><button onClick={() => void loadCases()}>查询</button></div>{cases?.available === false ? <p className="empty">{cases.reason || '外部案例不可用'}</p> : cases?.items?.length ? <div className="case-list">{cases.items.map((item) => <article key={item.externalId}><strong>{item.externalId} · {item.title}</strong><p>{item.vendorProject} · {item.product} · {item.provenanceStatus}</p><a href={item.sourceUrl} target="_blank" rel="noreferrer">来源</a></article>)}</div> : <p className="empty">暂无匹配案例</p>}</section>
    </div>
  </main>
}

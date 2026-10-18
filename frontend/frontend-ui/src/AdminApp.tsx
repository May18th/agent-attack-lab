import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './AdminApp.css'
import {
  apiErrorMessage, cancelAdminBattle, deleteAdminBattle, getAdminBattleAudit, getAdminBattleDetail,
  getAdminBattleEvents, getAdminBattleScore, getAdminDashboardSummary, getAdminExternalCases, getAdminMetrics,
  getAdminReport, getAdminSession, listAdminBattles, logoutAdminSession, retryAdminBattle,
  type AdminBattle, type AdminBattleListFilters, type AdminExternalCases,
} from './adminApi'
import { ApiError } from './api'

const Admin3DWorkspace = lazy(() => import('./admin3d/Admin3DWorkspace').then((module) => ({ default: module.Admin3DWorkspace })))

const PAGE_SIZE = 10
const statusLabels: Record<string, string> = { pending: '等待中', running: '进行中', completed: '已完成', failed: '失败' }
const difficultyLabels: Record<string, string> = { low: '低', mid: '中', high: '高' }
const label = (value?: string, labels: Record<string, string> = statusLabels) => value ? labels[value] ?? value : '暂无'
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
  const [cases, setCases] = useState<AdminExternalCases | null>(null)
  const [caseQuery, setCaseQuery] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const detailRequestId = useRef(0)

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

  const selectBattle = async (battle: AdminBattle) => {
    const requestId = ++detailRequestId.current
    setSelected(battle); setDetailData({})
    const entries = await Promise.allSettled([
      getAdminBattleDetail(battle.id), getAdminBattleScore(battle.id), getAdminBattleEvents(battle.id),
      getAdminBattleAudit(battle.id), getAdminReport(battle.id),
    ])
    const names = ['详情', '评分', '事件', '审计', '报告']
    const data: Record<string, unknown> = {}
    entries.forEach((entry, index) => { if (entry.status === 'fulfilled') data[names[index]] = entry.value })
    if (requestId !== detailRequestId.current) return
    setDetailData(data)
    const failed = entries.find((item) => item.status === 'rejected')
    if (requestId === detailRequestId.current && failed?.status === 'rejected') setError(errorText(failed.reason))
  }

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
      <Admin3DWorkspace metrics={metrics ?? {}} battles={battles} cases={cases} selectedBattle={selected} detailData={detailData} onSelectBattle={selectBattle} />
    </Suspense>
    <div id="admin-2d-workspace" className="admin-2d-workspace">
    <section className="admin-module metrics"><h2>运行指标</h2><div className="metric-grid">{overviewItems.length ? overviewItems.map(([key, value]) => <div className="metric" key={key}><span>{key}</span><strong>{String(value)}</strong></div>) : <div className="empty">暂无指标</div>}</div><pre className="data-preview" aria-label="态势数据">{jsonPreview(metrics)}</pre></section>
    <section className="admin-module"><div className="module-head"><h2>战局列表</h2><span>{total} 场</span></div><div className="filters"><input aria-label="搜索战局" placeholder="搜索主题或编号" value={query} onChange={(e) => { const value = e.target.value; setQuery(value); setPage(0); void loadList({ offset: 0, q: value }) }} onKeyDown={(e) => { if (e.key === 'Enter') void loadList({ offset: 0, q: query }) }} /><select aria-label="状态筛选" value={status} onChange={(e) => { const value = e.target.value; setStatus(value); setPage(0); void loadList({ offset: 0, status: value }) }}><option value="">全部状态</option>{Object.entries(statusLabels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select><button onClick={() => void loadList({ offset: 0 })}>查询</button></div>{loading ? <p>正在加载战局…</p> : <div className="battle-table">{battles.length ? battles.map((battle) => <button className="battle-row" key={battle.id} aria-label={`查看${battle.topic}`} onClick={() => void selectBattle(battle)}><span>{battle.topic || '未命名战局'}</span><span>{label(battle.status)} · {label(battle.difficulty, difficultyLabels)}</span><span>{battle.id}</span></button>) : <p className="empty">暂无战局</p>}</div>}<div className="pagination"><button disabled={page <= 0} onClick={() => { setPage(page - 1); void loadList({ offset: (page - 1) * PAGE_SIZE }) }}>上一页</button><span>第 {page + 1} / {pages} 页</span><button disabled={page + 1 >= pages} onClick={() => { setPage(page + 1); void loadList({ offset: (page + 1) * PAGE_SIZE }) }}>下一页</button></div></section>
    <section className="admin-module"><div className="module-head"><h2>战局详情</h2>{selected && <span>{selected.id}</span>}</div>{selected ? <><div className="detail-summary"><strong>{selected.topic || '未命名战局'}</strong><span>{label(selected.status)} · {label(selected.difficulty, difficultyLabels)}</span><div className="actions">{selected.status === 'failed' && <button disabled={busy} onClick={() => void runAction('retry')}>重试战局</button>}{(selected.status === 'pending' || selected.status === 'running') && <button disabled={busy} onClick={() => void runAction('cancel')}>取消战局</button>}{(selected.status === 'completed' || selected.status === 'failed') && <button className="danger" disabled={busy} onClick={() => void runAction('delete')}>删除战局</button>}</div></div><div className="detail-grid">{Object.entries(detailData).map(([key, value]) => <details open key={key}><summary>{key}</summary><pre className="data-preview">{jsonPreview(value)}</pre></details>)}</div></> : <p className="empty">选择战局查看详情、评分、事件、审计和报告。</p>}</section>
    <section className="admin-module"><div className="module-head"><h2>外部案例</h2><span>只读</span></div><div className="filters"><input aria-label="搜索外部案例" placeholder="搜索 CVE、厂商或产品" value={caseQuery} onChange={(e) => setCaseQuery(e.target.value)} /><button onClick={() => void loadCases()}>查询</button></div>{cases?.available === false ? <p className="empty">{cases.reason || '外部案例不可用'}</p> : cases?.items?.length ? <div className="case-list">{cases.items.map((item) => <article key={item.externalId}><strong>{item.externalId} · {item.title}</strong><p>{item.vendorProject} · {item.product} · {item.provenanceStatus}</p><a href={item.sourceUrl} target="_blank" rel="noreferrer">来源</a></article>)}</div> : <p className="empty">暂无匹配案例</p>}</section>
    </div>
  </main>
}

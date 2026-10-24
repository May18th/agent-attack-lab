import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import './AdminApp.css'
import {
  apiErrorMessage, cancelAdminBattle, deleteAdminBattle, getAdminBattleAudit, getAdminBattleDetail,
  getAdminBattleEvents, getAdminBattleRounds, getAdminBattleScore, getAdminDashboardSummary, getAdminExternalCases, getAdminMetrics,
  getAdminReport, getAdminSession, listAdminBattles, loginAdminSession, logoutAdminSession, retryAdminBattle,
  type AdminBattle, type AdminBattleEvent, type AdminBattleListFilters, type AdminBattleRounds, type AdminBattleScore, type AdminExternalCases,
} from './adminApi'
import { AdminBattleDetail } from './AdminBattleDetail'
import { AdminKpiBar } from './AdminKpiBar'
import { DIFFICULTY_LABELS, STATUS_LABELS, VERDICT_LABELS } from './adminLabels'
import { AdminManagementPanel } from './AdminManagementPanel'
import { AdminMetricsPanel } from './AdminMetricsPanel'
import { ApiError } from './api'
import { BattleTimeline3D } from './admin3d/BattleTimeline3D'

const Admin3DWorkspace = lazy(() => import('./admin3d/Admin3DWorkspace').then((module) => ({ default: module.Admin3DWorkspace })))

const PAGE_SIZE = 10
const label = (value?: string, labels: Record<string, string> = STATUS_LABELS) => value ? labels[value] ?? value : '暂无'
function formatBattleCreatedAt(value?: string): string {
  if (!value) return '时间未记录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })
}
function battleVerdictLabel(verdict?: AdminBattle['verdict']): string {
  return verdict ? label(verdict, VERDICT_LABELS) : '未生成判定'
}
function battleReviewLabel(battle: AdminBattle): string {
  if (battle.verdict === 'attacker_won') return '已验证结论'
  if (battle.verdict === 'defender_won') return '有拦截证据'
  if (battle.verdict === 'undetermined') return '证据不足'
  return '等待后端判定'
}
const COMMAND_ITEMS = [
  { key: 'front', label: '前台体验', description: '打开公开攻防体验与风险复盘', href: '/' },
  { key: 'workspace', label: '3D 工作台', description: '查看战局拓扑、时间线和实时事件', href: '#admin-3d-workspace' },
  { key: 'modules', label: '管理模块', description: '创建战局、管理主题、样本、规则与审计', href: '#admin-2d-workspace' },
] as const
type CommandItem = (typeof COMMAND_ITEMS)[number]
const WORKSPACE_TABS = [
  { key: 'overview', label: '总览', description: '看当前状态和回放', target: '#admin-overview' },
  { key: 'battles', label: '战局', description: '选择战局查看证据', target: '#admin-battles' },
  { key: 'management', label: '管理', description: '创建内容和调整规则', target: '#admin-management' },
  { key: 'monitoring', label: '监控', description: '看看运行是否正常', target: '#admin-monitoring' },
] as const
type WorkspaceTab = (typeof WORKSPACE_TABS)[number]['key']
const isWorkspaceTab = (value: string): value is WorkspaceTab => WORKSPACE_TABS.some((tab) => tab.key === value)
const workspaceTabFromUrl = (): WorkspaceTab => {
  if (typeof window === 'undefined') return 'overview'
  const value = window.location.hash.replace(/^#/, '')
  return isWorkspaceTab(value) ? value : 'overview'
}

function SecurityLockIcon() {
  return <svg className="security-lock" role="img" aria-label="安全登录" viewBox="0 0 24 24" fill="none" aria-hidden="false"><path d="M7.5 10V7.75a4.5 4.5 0 0 1 9 0V10" /><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M12 14v2" /></svg>
}

function HolographicNetwork() {
  return <div className="holo-network" role="img" aria-label="全息网络拓扑"><svg viewBox="0 0 600 500" fill="none" aria-hidden="true"><defs><pattern id="shield-dots" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r=".8" fill="#75a8cc" opacity=".42" /></pattern></defs><path className="holo-grid" d="M108 370 204 132l184 44 106 116M108 370l188 76 198-154M204 132l92 314M388 176l12 164 94 46" /><path className="holo-link" d="m108 370 188-142 92-52 106 116M204 132l92 96 198 24M296 446l-2-218" /><path className="holo-link holo-link-delayed" d="m108 370 186-142 2 218m198-244 106 116-12 14" /><circle className="holo-node holo-node-large" cx="296" cy="228" r="12" /><circle className="holo-node" cx="108" cy="370" r="7" /><circle className="holo-node" cx="204" cy="132" r="7" /><circle className="holo-node" cx="388" cy="176" r="7" /><circle className="holo-node" cx="494" cy="292" r="7" /><circle className="holo-node" cx="296" cy="446" r="7" /><circle className="holo-node" cx="400" cy="340" r="7" /><circle className="shield-ring" cx="296" cy="270" r="108" /><circle className="shield-ring" cx="296" cy="270" r="132" /><path className="holo-shield" d="M296 178 364 206v62c0 56-34 96-68 116-34-20-68-60-68-116v-62l68-28Z" /><path className="holo-shield-data" d="M244 238h104M244 252h104M250 266h92M258 280h76M268 294h56" /><path className="holo-shield-line" d="m263 263 23 23 45-52" /><path className="holo-shield-sweep" d="M228 214h136" /><g className="holo-server"><path d="m410 264 44 13v47l-44-14v-46Zm44 13 34-16v46l-34 17v-47Zm-44-13 34-17 44 14-34 16-44-13Z" /><path d="M422 282h8m-8 13h8m30-26 14-6m-14 20 14-6" /></g><g className="holo-key"><circle cx="166" cy="276" r="11" /><path d="m174 284 26 26m-8-8 8-8m-1 17 8-8" /></g><path className="holo-data-line" d="M184 276h56m196 26h40" /></svg><span className="data-stream stream-one" /><span className="data-stream stream-two" /><span className="data-stream stream-three" /></div>
}

function IndustryScene() {
  return <div className="industry-scene" role="img" aria-label="智能体攻防实验室数据基座"><svg viewBox="0 0 620 520" fill="none" aria-hidden="true"><defs><linearGradient id="scene-base" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#54d8ff" stopOpacity=".8" /><stop offset="1" stopColor="#7464ff" stopOpacity=".3" /></linearGradient><linearGradient id="scene-glass" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#9beaff" stopOpacity=".38" /><stop offset="1" stopColor="#6471ff" stopOpacity=".08" /></linearGradient><filter id="scene-glow"><feGaussianBlur stdDeviation="7" /></filter></defs><ellipse className="scene-halo" cx="280" cy="436" rx="244" ry="34" /><ellipse className="scene-ring scene-ring-one" cx="280" cy="428" rx="205" ry="34" /><ellipse className="scene-ring scene-ring-two" cx="280" cy="428" rx="160" ry="25" /><path className="scene-platform" d="m92 408 186-74 236 52-186 78-236-56Z" fill="url(#scene-base)" opacity=".35" /><path className="scene-platform-edge" d="m92 408 186 56 236-78m-236 78v24" /><g className="scene-tower scene-tower-left"><path d="m148 334 58-18 25 11-56 18-27-11Z" fill="url(#scene-glass)" /><path d="m148 334v48l27 12v-49m56-18v48l-56 19" fill="url(#scene-glass)" /><path d="M163 342h42M163 353h31M163 365h37" /></g><g className="scene-tower scene-tower-right"><path d="m388 296 72-22 27 12-70 23-29-13Z" fill="url(#scene-glass)" /><path d="m388 296v66l29 14v-67m70-35v65l-70 37" fill="url(#scene-glass)" /><path d="M405 307h56M405 321h43M405 335h50" /></g><g className="scene-core"><path d="m280 166 84 42v100l-84 46-84-46v-100l84-42Z" fill="url(#scene-glass)" /><path d="m280 166 84 42-84 48-84-48 84-42Z" fill="#8deaff" fillOpacity=".16" /><path d="M280 256v98" /><path d="m196 208 84 48 84-48" /><circle cx="280" cy="245" r="38" className="scene-core-orbit" /><path d="m252 250 21 21 39-47" className="scene-check" /><text x="280" y="312" textAnchor="middle" className="scene-label">AAL / CORE</text></g><g className="scene-float"><circle cx="138" cy="196" r="19" /><path d="M126 196h24m-12-12v24" /><circle cx="418" cy="166" r="17" /><path d="M409 166h18m-9-9v18" /><circle cx="482" cy="236" r="13" /><path d="M476 236h12m-6-6v12" /></g><path className="scene-data-line" d="M157 205 244 238m174-64-104 66m169-5-58 20" /><circle className="scene-data-dot" cx="223" cy="226" r="3" /><circle className="scene-data-dot" cx="379" cy="194" r="3" /><circle className="scene-data-dot" cx="432" cy="252" r="3" /></svg><div className="industry-caption"><strong>智能体攻防实验室</strong><span>AGENT ATTACK LAB · CONTROL CORE</span></div></div>
}

function AuthParticles() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const mouse = { x: -10_000, y: -10_000 }
    let width = 0; let height = 0; let dpr = 1; let raf = 0; let running = true
    let particles: Array<{ x: number; y: number; vx: number; vy: number; r: number; hot: boolean }> = []
    const resize = () => {
      const rect = canvas.getBoundingClientRect(); width = rect.width; height = rect.height
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const count = reduce ? 26 : Math.max(38, Math.min(120, Math.round(width * height / 15_000)))
      particles = Array.from({ length: count }, () => ({ x: Math.random() * width, y: Math.random() * height, vx: (Math.random() - .5) * .34, vy: (Math.random() - .5) * .34, r: Math.random() * 1.4 + .7, hot: Math.random() < .12 }))
    }
    const draw = () => {
      if (!running) return
      ctx.clearRect(0, 0, width, height); const link = 132
      for (let i = 0; i < particles.length; i += 1) for (let j = i + 1; j < particles.length; j += 1) {
        const a = particles[i]; const b = particles[j]; const dx = a.x - b.x; const dy = a.y - b.y; const d2 = dx * dx + dy * dy
        if (d2 > link * link) continue
        const distance = Math.sqrt(d2); ctx.strokeStyle = `rgba(103,232,249,${((1 - distance / link) * .26).toFixed(3)})`; ctx.lineWidth = .7; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
      }
      for (const particle of particles) {
        const dx = particle.x - mouse.x; const dy = particle.y - mouse.y; const distance = Math.hypot(dx, dy)
        if (!reduce && distance < 170 && distance > .1) { const force = (1 - distance / 170) * .22; particle.vx += (dx / distance) * force; particle.vy += (dy / distance) * force; ctx.strokeStyle = `rgba(167,139,250,${((1 - distance / 170) * .34).toFixed(3)})`; ctx.beginPath(); ctx.moveTo(particle.x, particle.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke() }
        particle.vx *= .982; particle.vy *= .982; const speed = Math.hypot(particle.vx, particle.vy)
        if (speed < .06) { particle.vx += (Math.random() - .5) * .08; particle.vy += (Math.random() - .5) * .08 }
        if (speed > 1.4) { particle.vx *= 1.4 / speed; particle.vy *= 1.4 / speed }
        particle.x += particle.vx; particle.y += particle.vy
        if (particle.x < 0 || particle.x > width) particle.vx *= -1; if (particle.y < 0 || particle.y > height) particle.vy *= -1
        particle.x = Math.max(0, Math.min(width, particle.x)); particle.y = Math.max(0, Math.min(height, particle.y))
        ctx.shadowBlur = particle.hot ? 12 : 0; ctx.shadowColor = 'rgba(34,211,238,.95)'; ctx.fillStyle = particle.hot ? 'rgba(165,243,252,.98)' : 'rgba(125,211,252,.62)'; ctx.beginPath(); ctx.arc(particle.x, particle.y, particle.r, 0, Math.PI * 2); ctx.fill()
      }
      raf = window.requestAnimationFrame(draw)
    }
    const handlePointer = (event: PointerEvent) => { mouse.x = event.clientX; mouse.y = event.clientY }
    const handleVisibility = () => { running = !document.hidden; if (running && !raf) raf = window.requestAnimationFrame(draw); if (!running && raf) { window.cancelAnimationFrame(raf); raf = 0 } }
    resize(); draw(); window.addEventListener('resize', resize); window.addEventListener('pointermove', handlePointer, { passive: true }); document.addEventListener('visibilitychange', handleVisibility)
    return () => { running = false; window.cancelAnimationFrame(raf); window.removeEventListener('resize', resize); window.removeEventListener('pointermove', handlePointer); document.removeEventListener('visibilitychange', handleVisibility) }
  }, [])
  return <canvas ref={canvasRef} className="auth-particles" aria-hidden="true" />
}

function AuthClock() {
  const [time, setTime] = useState(() => new Date())
  useEffect(() => { const timer = window.setInterval(() => setTime(new Date()), 1_000); return () => window.clearInterval(timer) }, [])
  return <span>{time.toLocaleTimeString('zh-CN', { hour12: false })}</span>
}

function AuthFrame({ children }: { children: React.ReactNode }) {
  return <main className="admin-shell auth-shell"><div className="auth-aurora auth-aurora-one" /><div className="auth-aurora auth-aurora-two" /><div className="auth-floor" /><AuthParticles /><div className="auth-vignette" /><div className="auth-hud auth-hud-top"><span><i /> SYSTEM ONLINE <b>/</b> ADMIN AUTH v2.4</span><AuthClock /></div><div className="auth-hud auth-hud-bottom"><span>ENCRYPTED CHANNEL · AES-256</span><span>WUTONG SECURITY LAB</span></div><IndustryScene /><HolographicNetwork /><div className="holo-core-mark" aria-hidden="true"><span className="holo-core-orbit" /><strong>AAL</strong><small>SECURITY CORE</small><i className="holo-core-data holo-core-data-one" /><i className="holo-core-data holo-core-data-two" /></div><section className="admin-auth auth-card"><span className="auth-border-sweep" aria-hidden="true" />{children}</section></main>
}

function errorText(error: unknown): string {
  const message = apiErrorMessage(error)
  const requestId = error instanceof ApiError ? error.requestId : undefined
  return requestId ? `${message}（请求 ID：${requestId}）` : message
}

export default function AdminApp() {
  const showRawData = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1'
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
  const [rounds, setRounds] = useState<AdminBattleRounds | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [activeNav, setActiveNav] = useState<CommandItem['key']>('workspace')
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>(() => workspaceTabFromUrl())
  const [navIndicator, setNavIndicator] = useState({ left: 0, width: 0 })
  const navRef = useRef<HTMLElement>(null)
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

  useEffect(() => {
    const syncWorkspaceFromUrl = () => {
      const next = workspaceTabFromUrl()
      setWorkspaceTab(next)
      setActiveNav(next === 'management' ? 'modules' : 'workspace')
    }
    window.addEventListener('hashchange', syncWorkspaceFromUrl)
    window.addEventListener('popstate', syncWorkspaceFromUrl)
    return () => {
      window.removeEventListener('hashchange', syncWorkspaceFromUrl)
      window.removeEventListener('popstate', syncWorkspaceFromUrl)
    }
  }, [])

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
    if (select) { setSelected(battle); setDetailData({}); setRounds(null); setSelectedTimelineEvent(null); setTimelineQuery(''); setEventPageInfo({ total: 0, hasMore: false }); loadingMoreEventsRef.current = false }
    const entries = await Promise.allSettled([
      getAdminBattleDetail(battle.id), getAdminBattleScore(battle.id), getAdminBattleEvents(battle.id),
      getAdminBattleAudit(battle.id), getAdminReport(battle.id), getAdminBattleRounds(battle.id),
    ])
    const names = ['详情', '评分', '事件页', '审计', '报告', '回合']
    const data: Record<string, unknown> = {}
    entries.forEach((entry, index) => { if (entry.status === 'fulfilled') data[names[index]] = entry.value })
    if (requestId !== detailRequestId.current) return
    const roundData = data['回合'] as AdminBattleRounds | undefined
    delete data['回合']
    setRounds(roundData ?? null)
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
    try {
      const nextPage = await getAdminBattleEvents(battleId, afterSequence)
      if (requestId !== detailRequestId.current) return
      setDetailData((current) => ({ ...current, '事件': [...(current['事件'] as AdminBattleEvent[] ?? []), ...nextPage.items] }))
      setEventPageInfo({ total: nextPage.total, hasMore: nextPage.hasMore })
    } catch (e) { setError(errorText(e)) }
    finally { loadingMoreEventsRef.current = false }
  }, [detailData, eventPageInfo.hasMore, selected])

  const selectedBattleId = selected?.id
  const selectedBattleStatus = selected?.status
  useLayoutEffect(() => {
    const updateIndicator = () => {
      const item = navRef.current?.querySelector(`[data-nav-key="${activeNav}"]`) as HTMLElement | null
      if (!item) return
      setNavIndicator({ left: item.offsetTop, width: item.offsetWidth })
    }
    updateIndicator()
    window.addEventListener('resize', updateIndicator)
    return () => window.removeEventListener('resize', updateIndicator)
  }, [activeNav])

  const navigateToWorkspaceTab = (tab: typeof WORKSPACE_TABS[number], replace = false) => {
    setWorkspaceTab(tab.key)
    setActiveNav(tab.key === 'management' ? 'modules' : 'workspace')
    const nextHash = `#${tab.key}`
    if (window.location.hash !== nextHash) {
      const url = `${window.location.pathname}${window.location.search}${nextHash}`
      if (replace) window.history.replaceState(null, '', url)
      else window.history.pushState(null, '', url)
    }
  }

  const navigateToCommand = (item: CommandItem) => {
    setActiveNav(item.key)
    if (item.href === '/') {
      window.location.assign(item.href)
      return
    }
    if (item.key === 'workspace') navigateToWorkspaceTab(WORKSPACE_TABS[0])
    if (item.key === 'modules') navigateToWorkspaceTab(WORKSPACE_TABS[2])
  }
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
  const activeWorkspace = WORKSPACE_TABS.find((tab) => tab.key === workspaceTab) ?? WORKSPACE_TABS[0]
  if (!session) return <AuthFrame><div className="auth-mark"><SecurityLockIcon /><span>安全会话</span></div><h1>管理员后台 - 会话检查</h1><p className="auth-description">正在验证当前访问凭据，请稍候。</p>{sessionError && <p className="admin-error" role="alert">{sessionError}</p>}<button className="auth-secondary" onClick={() => void checkSession()}>重新检查会话</button></AuthFrame>
  if (session.enabled && !session.authenticated) return <AuthFrame><div className="auth-mark"><SecurityLockIcon /><span>安全会话 · WUTONG SECURITY LAB</span></div><h1>管理员后台 - 管理员认证</h1><p className="auth-description">使用后台管理密码建立安全会话。</p><p className="auth-description auth-description-detail">进入攻防战局与风险证据工作台。</p><form onSubmit={(event) => void handlePasswordLogin(event)}><div className="auth-field"><input id="admin-login-password" type="password" placeholder=" " autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} required maxLength={256} disabled={loginBusy} /><label htmlFor="admin-login-password">后台管理密码</label></div><button className="auth-primary" type="submit" disabled={loginBusy} aria-busy={loginBusy}><span>{loginBusy ? '登录中…' : '登录管理后台'}</span><i aria-hidden="true" /></button></form>{sessionError && <p className="admin-error" role="alert">{sessionError}</p>}<button className="auth-secondary" type="button" onClick={() => void checkSession()} disabled={loginBusy}>我已完成认证，重新检查</button><p className="auth-footnote"><span className="auth-footnote-dot" />仅建立后台会话，不会保存密码</p></AuthFrame>

  return <main className="admin-shell">
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand"><span className="brand-mark">✦</span><div><strong>智能体攻防实验室</strong><small>管理后台</small></div></div>
        <span className="sidebar-label">工作区</span>
        <nav className="admin-nav" aria-label="工作区导航" ref={navRef}>
          <span className="admin-nav-highlight" aria-hidden="true" style={{ width: navIndicator.width, transform: `translateY(${navIndicator.left}px)` }} />
          {COMMAND_ITEMS.map((item) => item.key === 'front' ? <a key={item.key} className="admin-nav-link" data-nav-key={item.key} href={item.href}><span className="nav-icon" aria-hidden="true">↗</span>{item.label}</a> : <button key={item.key} type="button" className="admin-nav-link" data-nav-key={item.key} onClick={() => navigateToCommand(item)}><span className="nav-icon" aria-hidden="true">{item.key === 'workspace' ? '◈' : '☷'}</span>{item.label}</button>)}
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-status"><span className="status-dot" aria-hidden="true" />系统运行正常</div>
        <button className="sidebar-logout" onClick={() => void handleLogout()}>退出会话</button>
      </aside>
      <div className="admin-content">
        <header className="admin-header">
          <div className="admin-brand"><span className="admin-kicker">智能体攻防实验室 / 总控台</span><h1>管理<em>总控台</em></h1><p className="admin-sub">把战局、证据与规则放在同一条可追溯的工作流里。</p></div>
        </header>
        <nav className="workspace-tabs" aria-label="后台工作区" role="tablist">
          {WORKSPACE_TABS.map((tab) => <button key={tab.key} type="button" role="tab" aria-selected={workspaceTab === tab.key} aria-controls={tab.target.slice(1)} className={workspaceTab === tab.key ? 'active' : ''} onClick={() => navigateToWorkspaceTab(tab)}><span>{tab.label}</span><small>{tab.description}</small></button>)}
        </nav>
    {error && <div className="admin-error" role="alert">{error}</div>}
    <div className="workspace-heading"><div><span className="workspace-heading-kicker">当前工作区</span><h2>{activeWorkspace.label}</h2><p>{activeWorkspace.description}</p></div><span className="workspace-heading-route">/admin/{activeWorkspace.key}</span></div>
    {workspaceTab === 'overview' && <section id="admin-overview" className="workspace-panel workspace-overview" role="tabpanel" aria-label="总览工作区">
    <AdminKpiBar summary={summary} metrics={metrics} />
    <div id="admin-3d-workspace" className="admin-3d-anchor">
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
    </div>
    </section>}
    {workspaceTab === 'management' && <section id="admin-management" className="workspace-panel workspace-management" role="tabpanel" aria-label="管理工作区">
    <AdminManagementPanel battles={battles} onBattleCreated={handleBattleCreated} onError={setError} />
    </section>}
    {workspaceTab === 'monitoring' && <section id="admin-monitoring" className="workspace-panel workspace-monitoring" role="tabpanel" aria-label="监控工作区">
    <AdminMetricsPanel summary={summary} metrics={metrics} />
    <section className="workspace-panel workspace-evidence" aria-label="外部案例">
    <details className="admin-module external-case-module" role="group" aria-label="外部案例"><summary className="module-head"><h2>外部案例</h2><span>只读</span></summary><div className="external-case-content"><div className="filters"><input aria-label="搜索外部案例" placeholder="搜索 CVE、厂商或产品" value={caseQuery} onChange={(e) => setCaseQuery(e.target.value)} /><button onClick={() => void loadCases()}>查询</button></div>{cases?.available === false ? <p className="empty">{cases.reason || '外部案例不可用'}</p> : cases?.items?.length ? <div className="case-list">{cases.items.map((item) => <article key={item.externalId}><strong>{item.externalId} · {item.title}</strong><p>{item.vendorProject} · {item.product} · {item.provenanceStatus}</p><a href={item.sourceUrl} target="_blank" rel="noreferrer">来源</a></article>)}</div> : <p className="empty">暂无匹配案例</p>}</div></details>
    </section>
    </section>}
    {workspaceTab === 'battles' && <section id="admin-battles" className="workspace-panel workspace-battles" role="tabpanel" aria-label="战局工作区">
    <div className="admin-operations-grid">
    <section className="admin-module"><div className="module-head"><h2>战局列表</h2><span>{total} 场</span></div><div className="filters"><input aria-label="搜索战局" placeholder="搜索主题或编号" value={query} onChange={(e) => { const value = e.target.value; setQuery(value); setPage(0); void loadList({ offset: 0, q: value }) }} onKeyDown={(e) => { if (e.key === 'Enter') void loadList({ offset: 0, q: query }) }} /><select aria-label="状态筛选" value={status} onChange={(e) => { const value = e.target.value; setStatus(value); setPage(0); void loadList({ offset: 0, status: value }) }}><option value="">全部状态</option>{Object.entries(STATUS_LABELS).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select><button onClick={() => void loadList({ offset: 0 })}>查询</button></div>{loading ? <p>正在加载战局…</p> : <div className="battle-table">{battles.length ? battles.map((battle) => <button className="battle-row" key={battle.id} aria-label={`查看${battle.topic || '未命名战局'}`} aria-describedby={`battle-meta-${battle.id}`} onClick={() => void selectBattle(battle)}><span className="battle-row-primary"><strong>{battle.topic || '未命名战局'}</strong><small id={`battle-meta-${battle.id}`}>{battle.code ?? '未编号'} · {formatBattleCreatedAt(battle.createdAt)}</small></span><span className="battle-row-status"><i className={`battle-status-dot status-${battle.status}`} />{label(battle.status)} · {label(battle.difficulty, DIFFICULTY_LABELS)} · {battle.rounds ?? 3} 轮</span><span className={`battle-row-verdict verdict-${battle.verdict ?? 'review'}`}><strong>{battleVerdictLabel(battle.verdict)}</strong><small>{battleReviewLabel(battle)}</small></span></button>) : <p className="empty">暂无战局</p>}</div>}<div className="pagination"><button disabled={page <= 0} onClick={() => { setPage(page - 1); void loadList({ offset: (page - 1) * PAGE_SIZE }) }}>上一页</button><span>第 {page + 1} / {pages} 页</span><button disabled={page + 1 >= pages} onClick={() => { setPage(page + 1); void loadList({ offset: (page + 1) * PAGE_SIZE }) }}>下一页</button></div></section>
    <section className="admin-module"><div className="module-head"><h2>战局详情</h2>{selected && <span>{selected.code ?? selected.id}</span>}</div>{selected ? <><div className="detail-summary"><strong>{selected.topic || '未命名战局'}</strong><span>{label(selected.status)} · {label(selected.difficulty, DIFFICULTY_LABELS)}</span><div className="actions">{selected.status === 'failed' && <button disabled={busy} onClick={() => void runAction('retry')}>重试战局</button>}{(selected.status === 'pending' || selected.status === 'running') && <button disabled={busy} onClick={() => void runAction('cancel')}>取消战局</button>}{(selected.status === 'completed' || selected.status === 'failed') && <button className="danger" disabled={busy} onClick={() => void runAction('delete')}>删除战局</button>}</div></div><AdminBattleDetail battle={selected} rounds={rounds} score={detailData['评分'] as AdminBattleScore | null | undefined} events={Array.isArray(detailData['事件']) ? detailData['事件'] as AdminBattleEvent[] : []} audit={detailData['审计'] && typeof detailData['审计'] === 'object' ? detailData['审计'] as Record<string, unknown> : {}} detailData={detailData} showRawData={showRawData} hasMoreEvents={eventPageInfo.hasMore} onLoadMoreEvents={() => void loadMoreEvents()} selectedEvent={selectedTimelineEvent} onSelectEvent={setSelectedTimelineEvent} /><BattleTimeline3D battle={selected} events={Array.isArray(detailData['事件']) ? detailData['事件'] as AdminBattleEvent[] : []} eventsTotal={eventPageInfo.total} hasMoreEvents={eventPageInfo.hasMore} onLoadMoreEvents={() => void loadMoreEvents()} audit={detailData['审计'] && typeof detailData['审计'] === 'object' ? detailData['审计'] as Record<string, unknown> : {}} score={detailData['评分'] as AdminBattleScore | null | undefined} selectedEvent={selectedTimelineEvent} onSearchQueryChange={setTimelineQuery} onSelectEvent={setSelectedTimelineEvent} /><span className="sr-only" aria-live="polite">{selectedTimelineEvent ? `当前选择事件 ${selectedTimelineEvent.sequence ?? ''} ${selectedTimelineEvent.type ?? selectedTimelineEvent.eventType ?? ''}` : ''}</span></> : <p className="empty">选择战局查看详情、评分、事件、审计和报告。</p>}</section>
    </div>
    </section>}
      </div>
    </div>
  </main>
}

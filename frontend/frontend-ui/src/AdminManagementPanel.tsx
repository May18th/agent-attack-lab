import { useCallback, useEffect, useState } from 'react'
import {
  apiErrorMessage, createAdminBattle, createAdminRule, createAdminSample, deleteAdminRule, deleteAdminSample,
  exportAdminSurveyCsv, exportAdminSurveyPdf, exportAdminBattlesPdf, listAdminAuditLogs, listAdminRules, listAdminSamples, seedAdminLibrary, updateAdminRule, updateAdminSample,
  type AdminAuditLog, type AdminBattle, type AdminRule, type AdminSample,
} from './adminApi'
import {
  DEFAULT_ROUNDS, DIFFICULTY_LABELS, DIFFICULTY_TACTICS, MAX_ROUNDS, MIN_ROUNDS, PRESET_THEMES,
  addCustomTheme, loadCustomThemes, removeCustomTheme, type TacticLevel,
} from './themes'
import {
  ACTOR_LABELS, AUDIT_DATA_LABELS, AUDIT_FIELD_HINTS, AUDIT_STATUS_LABELS, EVENT_LABELS, VERDICT_LABELS, formatDateTime, labelOf,
} from './adminLabels'

type ManagementTab = 'create' | 'samples' | 'rules' | 'audit'
type SampleValues = Pick<AdminSample, 'topic' | 'content' | 'source'>
type RuleValues = Pick<AdminRule, 'name' | 'condition' | 'action'>
type DialogState =
  | { kind: 'sample'; id?: string; values: SampleValues }
  | { kind: 'rule'; id?: string; values: RuleValues }
  | { kind: 'delete-sample'; id: string; label: string }
  | { kind: 'delete-rule'; id: string; label: string }
  | null
type Props = { battles: AdminBattle[]; onBattleCreated: (battle: AdminBattle) => void; onError: (message: string) => void }
const emptySample: SampleValues = { topic: '', content: '', source: '' }
const emptyRule: RuleValues = { name: '', condition: '', action: '拦截' }
const download = (name: string, content: string, type: string) => { const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url) }
/** 后端已生成好的文件（如问卷 CSV）直接落盘，不再二次编码。 */
const saveBlob = (name: string, blob: Blob) => { const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url) }
/** 问卷文件名带上导出日期，多次导出不会互相覆盖。 */
const surveyFileName = () => `问卷结果-${new Date().toLocaleDateString('sv-SE')}.csv`
const csv = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
/** 审计日志 data 的键值化渲染：不再把 JSON 整段甩给使用者。 */
const auditEntries = (data: unknown): [string, unknown][] => (data && typeof data === 'object' && !Array.isArray(data) ? Object.entries(data as Record<string, unknown>) : [])
const auditValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}
/** 长 ID / 长文本在卡片里截断，完整值挂到 title 上。 */
const MAX_INLINE = 80
const shorten = (text: string) => (text.length > MAX_INLINE ? `${text.slice(0, MAX_INLINE)}…` : text)
/** datetime-local 是本地无时区值，后端按 UTC 存储，必须先转成 UTC ISO。 */
const toUtcIso = (value: string): string => {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString()
}
/** 一行人话摘要：不翻事件表也能知道这条日志干了什么。 */
const auditSummary = (log: AdminAuditLog): string => {
  const data = (log.data && typeof log.data === 'object' ? log.data : {}) as Record<string, unknown>
  const actor = labelOf(log.actorRole, ACTOR_LABELS, '未知来源')
  if (log.eventType === 'http.request') {
    const method = auditValue(data.method) === '—' ? '' : auditValue(data.method)
    const path = auditValue(data.path) === '—' ? '—' : auditValue(data.path)
    const code = auditValue(data.statusCode) === '—' ? '' : ` → ${auditValue(data.statusCode)}`
    const cost = typeof data.durationMs === 'number' ? ` · ${Math.round(data.durationMs)} ms` : ''
    return `${[method, path].filter(Boolean).join(' ')}${code}${cost}`.trim()
  }
  // 业务事件给出「谁 · 做了什么 · 结果」，而不是只回显事件名。
  if (log.eventType === 'battle.completed') {
    const code = [data.battleCode, data.battleId].find((value) => typeof value === 'string' && value)
    const verdict = labelOf(data.verdict, VERDICT_LABELS, '未判定')
    const detail = [
      typeof data.compromisedRounds === 'number' ? `沦陷 ${data.compromisedRounds} 轮` : '',
      typeof data.interceptedRounds === 'number' ? `拦截 ${data.interceptedRounds} 轮` : '',
    ].filter(Boolean)
    return `${actor}完成战局${code ? ` ${code}` : ''}：判定${verdict}${detail.length ? `（${detail.join(' / ')}）` : ''}`
  }
  if (log.eventType === 'attack.sample.generated') {
    const sample = (data.sample && typeof data.sample === 'object' ? data.sample : {}) as Record<string, unknown>
    const round = typeof data.round === 'number' ? `第 ${data.round} 轮` : ''
    const tactic = typeof sample.tactic === 'string' && sample.tactic ? `战术 ${sample.tactic}` : ''
    const strength = typeof sample.strengthTier === 'string'
      ? `强度 ${sample.strengthTier}${typeof sample.strengthScore === 'number' ? `/${sample.strengthScore}` : ''}`
      : ''
    const parts = [round, tactic, strength].filter(Boolean)
    return `${actor}生成攻击样本${parts.length ? `：${parts.join(' · ')}` : ''}`
  }
  if (log.eventType === 'round.completed') {
    const round = typeof data.round === 'number' ? `第 ${data.round} 轮` : ''
    const caught = Array.isArray(data.caught) ? data.caught.length : null
    const verdict = typeof data.classification === 'string' ? labelOf(data.classification, VERDICT_LABELS, data.classification) : ''
    const parts = [round, caught === null ? '' : `命中 ${caught} 条规则`, verdict].filter(Boolean)
    return `${actor}回合结算${parts.length ? `：${parts.join(' · ')}` : ''}`
  }
  if (log.eventType === 'admin.library.seeded') {
    const created = typeof data.samplesCreated === 'number' ? `新增样本 ${data.samplesCreated} 条` : ''
    const rules = typeof data.rulesCreated === 'number' ? `规则 ${data.rulesCreated} 条` : ''
    return `${actor}载入内置示例${[created, rules].filter(Boolean).length ? `：${[created, rules].filter(Boolean).join('、')}` : ''}`
  }
  const event = labelOf(log.eventType, EVENT_LABELS, log.eventType)
  if (log.eventType.startsWith('agent.call.')) {
    // 智能体调用是审计里量最大的业务事件：只写"调用完成"等于没写，
    // 至少要能看出谁、第几轮、哪个阶段、走了模型还是规则、花了多久。
    const role = labelOf(data.agentRole, ACTOR_LABELS, String(data.agentRole ?? '智能体'))
    const round = typeof data.round === 'number' ? `第 ${data.round} 轮` : ''
    const stage = typeof data.stageId === 'string' ? `阶段 ${data.stageId}` : ''
    const source = typeof data.resultSource === 'string' ? `来源 ${data.resultSource}` : ''
    const cost = typeof data.durationMs === 'number' ? `耗时 ${Math.round(data.durationMs)} ms` : ''
    const parts = [round, stage, source, cost].filter(Boolean)
    return `${role}${event}${parts.length ? `：${parts.join(' · ')}` : ''}`
  }
  const subject = [data.topic, data.name, data.battleCode].find((value) => typeof value === 'string' && value.trim())
  const id = [data.battleId, data.sampleId, data.ruleId].find((value) => typeof value === 'string' && value)
  if (subject && id) return `${actor}${event}：${subject}（${id}）`
  if (subject) return `${actor}${event}：${subject}`
  if (id) return `${actor}${event}：${id}`
  return `${actor}${event}`
}

type LibraryEmptyProps = { kind: 'sample' | 'rule'; busy: boolean; onSeed: () => void }
const LIBRARY_COPY = {
  sample: {
    title: '暂无攻击样本',
    lead: '样本库是攻击方的弹药：战局开始时会按主题匹配样本，命中同主题的条目会作为提示交给攻击智能体。',
    bullet: ['库为空时攻击方只能退回内置规则库，生成内容与主题无关，评测参考价值低。', '一条样本 = 主题 + 合成输入 + 来源，可随时编辑或删除。'],
    action: '载入内置示例样本',
  },
  rule: {
    title: '暂无防守规则',
    lead: '规则库是防守方的判据：每轮检测会按主题匹配规则，命中即触发拦截或放行，并累计命中次数。',
    bullet: ['规则不填主题即对所有主题生效，适合放基线检测项。', '规则只作为提示提供给防守智能体，不会直接改动评分逻辑。'],
    action: '载入内置示例规则',
  },
} as const
function LibraryEmpty({ kind, busy, onSeed }: LibraryEmptyProps) {
  const copy = LIBRARY_COPY[kind]
  return <div className="library-empty">
    <strong>{copy.title}</strong>
    <p>{copy.lead}</p>
    <ul>{copy.bullet.map((item) => <li key={item}>{item}</li>)}</ul>
    <button className="primary-action" type="button" disabled={busy} onClick={onSeed}>{busy ? '载入中…' : copy.action}</button>
  </div>
}

export function AdminManagementPanel({ battles, onBattleCreated, onError }: Props) {
  const [tab, setTab] = useState<ManagementTab>('create')
  const [topic, setTopic] = useState<string>(PRESET_THEMES[0])
  const [difficulty, setDifficulty] = useState<TacticLevel>('mid')
  const [rounds, setRounds] = useState(DEFAULT_ROUNDS)
  const [busy, setBusy] = useState(false)
  const [customThemes, setCustomThemes] = useState<string[]>(() => loadCustomThemes())
  const [newTheme, setNewTheme] = useState('')
  const [samples, setSamples] = useState<AdminSample[]>([])
  const [rules, setRules] = useState<AdminRule[]>([])
  const [logs, setLogs] = useState<AdminAuditLog[]>([])
  const [sampleQuery, setSampleQuery] = useState('')
  const [ruleQuery, setRuleQuery] = useState('')
  const [auditFilters, setAuditFilters] = useState({ from_time: '', to_time: '', user: '', operation: '', includeHttp: false })
  const [dialog, setDialog] = useState<DialogState>(null)
  const [notice, setNotice] = useState('')
  const [surveyBusy, setSurveyBusy] = useState(false)
  const [surveyPdfBusy, setSurveyPdfBusy] = useState(false)
  const [battlePdfBusy, setBattlePdfBusy] = useState(false)
  const [surveyNotice, setSurveyNotice] = useState('')
  const loadSamples = useCallback(async (q = sampleQuery) => { try { setSamples((await listAdminSamples(q)).items) } catch (error) { onError(apiErrorMessage(error)) } }, [onError, sampleQuery])
  const loadRules = useCallback(async (q = ruleQuery) => { try { setRules((await listAdminRules(q)).items) } catch (error) { onError(apiErrorMessage(error)) } }, [onError, ruleQuery])
  const loadAudit = useCallback(async (filters = auditFilters) => {
    try {
      const { includeHttp, ...rest } = filters
      setLogs(await listAdminAuditLogs({ ...rest, includeHttp, from_time: toUtcIso(filters.from_time), to_time: toUtcIso(filters.to_time) }))
    } catch (error) { onError(apiErrorMessage(error)) }
  }, [auditFilters, onError])
  const selectTab = (next: ManagementTab) => { setTab(next); setNotice(''); if (next === 'samples') void loadSamples(); if (next === 'rules') void loadRules() }
  // 空库不是故障而是没初始化：给一个幂等的一键载入，避免用户以为页面坏了。
  const seedLibrary = async (kind: 'samples' | 'rules') => {
    setBusy(true)
    try {
      const result = await seedAdminLibrary()
      setNotice(`已载入内置示例：新增样本 ${result.samples.created} 条（跳过 ${result.samples.skipped} 条）、新增规则 ${result.rules.created} 条（跳过 ${result.rules.skipped} 条）`)
      if (kind === 'samples') await loadSamples()
      else await loadRules()
    } catch (error) { onError(apiErrorMessage(error)) } finally { setBusy(false) }
  }
  useEffect(() => { if (tab === 'audit') void loadAudit() }, [auditFilters, loadAudit, tab])
  const submitBattle = async (event: React.FormEvent) => {
    event.preventDefault()
    const value = topic.trim()
    if (!value) { onError('主题不能为空'); return }
    // 自定义主题在启动时同步进主题库，前台刷新后下拉里就能选到。
    setCustomThemes(addCustomTheme(value))
    setTopic(value)
    setBusy(true)
    try { onBattleCreated(await createAdminBattle({ topic: value, difficulty, rounds })); setTab('create') } catch (error) { onError(apiErrorMessage(error)) } finally { setBusy(false) }
  }
  const handleAddTheme = () => {
    const value = newTheme.trim()
    if (!value) return
    setCustomThemes(addCustomTheme(value))
    setNewTheme('')
  }
  const handleRemoveTheme = (theme: string) => {
    setCustomThemes(removeCustomTheme(theme))
  }
  const submitSample = async (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!dialog || dialog.kind !== 'sample') return; setBusy(true); try { if (dialog.id) await updateAdminSample(dialog.id, dialog.values); else await createAdminSample(dialog.values); setDialog(null); await loadSamples() } catch (error) { onError(apiErrorMessage(error)) } finally { setBusy(false) } }
  const submitRule = async (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!dialog || dialog.kind !== 'rule') return; setBusy(true); try { if (dialog.id) await updateAdminRule(dialog.id, dialog.values); else await createAdminRule(dialog.values); setDialog(null); await loadRules() } catch (error) { onError(apiErrorMessage(error)) } finally { setBusy(false) } }
  const confirmDelete = async () => { if (!dialog || (dialog.kind !== 'delete-sample' && dialog.kind !== 'delete-rule')) return; setBusy(true); try { if (dialog.kind === 'delete-sample') { await deleteAdminSample(dialog.id); await loadSamples() } else { await deleteAdminRule(dialog.id); await loadRules() }; setDialog(null) } catch (error) { onError(apiErrorMessage(error)) } finally { setBusy(false) } }
  const exportBattles = () => { const rows = [['战局 ID', '主题', '时间', '状态', '难度', '评分'], ...battles.map((battle) => [battle.id, battle.topic, battle.createdAt, battle.status, battle.difficulty, '待评分'])]; download('攻防战局.csv', '\ufeff' + rows.map((row) => row.map(csv).join(',')).join('\n'), 'text/csv;charset=utf-8') }
  // 战局 PDF 由后端排版（含状态/难度/裁决中文化），前端 CSV 仍走本地生成。
  const exportBattlesPdf = async () => {
    if (battlePdfBusy) return
    setBattlePdfBusy(true)
    setSurveyNotice('')
    try {
      const { blob, filename, total } = await exportAdminBattlesPdf()
      const name = filename || `攻防战局-${new Date().toLocaleDateString('sv-SE')}.pdf`
      saveBlob(name, blob)
      if (!Number.isFinite(total)) setSurveyNotice(`已导出战局清单：${name}`)
      else setSurveyNotice(`已导出 ${total} 场战局的清单：${name}`)
    } catch (error) { onError(apiErrorMessage(error)) } finally { setBattlePdfBusy(false) }
  }
  // 问卷 CSV 由后端按固定列序生成，前端只负责下载与提示，避免两份字段定义漂移。
  const exportSurvey = async () => {
    if (surveyBusy) return
    setSurveyBusy(true)
    setSurveyNotice('')
    try {
      const { blob, filename, total } = await exportAdminSurveyCsv()
      const name = filename || surveyFileName()
      saveBlob(name, blob)
      if (!Number.isFinite(total)) setSurveyNotice(`已导出问卷数据：${name}`)
      else if (total > 0) setSurveyNotice(`已导出 ${total} 份问卷：${name}`)
      else setSurveyNotice('暂无问卷提交，已导出仅含表头的空表')
    } catch (error) { onError(apiErrorMessage(error)) } finally { setSurveyBusy(false) }
  }
  // PDF 由后端排版成报告，前端只负责下载，避免两套版式漂移。
  // 汇总与明细分两个文件导出：材料正文只放汇总，原始记录单独归档。
  const exportSurveyPdf = async (part: 'summary' | 'detail') => {
    if (surveyPdfBusy) return
    setSurveyPdfBusy(true)
    setSurveyNotice('')
    try {
      const { blob, filename, total } = await exportAdminSurveyPdf(part)
      const suffix = part === 'summary' ? '问卷汇总' : '问卷明细'
      const name = filename || `${suffix}-${new Date().toLocaleDateString('sv-SE')}.pdf`
      saveBlob(name, blob)
      const label = part === 'summary' ? '问卷汇总报告' : '问卷明细记录'
      if (!Number.isFinite(total)) setSurveyNotice(`已导出${label}：${name}`)
      else if (total > 0) setSurveyNotice(`已导出 ${total} 份问卷的${label}：${name}`)
      else setSurveyNotice(`暂无问卷提交，已导出空白${label}`)
    } catch (error) { onError(apiErrorMessage(error)) } finally { setSurveyPdfBusy(false) }
  }
  return <section className="admin-module admin-management" aria-label="后台功能管理">
    <div className="module-head"><h2>后台功能管理</h2><div className="management-export"><button type="button" onClick={exportBattles}>导出战局（CSV）</button><button type="button" disabled={battlePdfBusy} aria-busy={battlePdfBusy} onClick={() => void exportBattlesPdf()}>{battlePdfBusy ? '生成中…' : '导出战局（PDF）'}</button><button type="button" disabled={surveyBusy} aria-busy={surveyBusy} onClick={() => void exportSurvey()}>{surveyBusy ? '导出中…' : '导出问卷（CSV）'}</button><button type="button" disabled={surveyPdfBusy} aria-busy={surveyPdfBusy} onClick={() => void exportSurveyPdf('summary')}>导出问卷汇总（PDF）</button><button type="button" disabled={surveyPdfBusy} aria-busy={surveyPdfBusy} onClick={() => void exportSurveyPdf('detail')}>导出问卷明细（PDF）</button></div></div>
    {surveyNotice && <p className="management-notice" role="status">{surveyNotice}</p>}
    <nav className="management-tabs" aria-label="管理模块" role="tablist">{([['create', '创建战局'], ['samples', '样本库'], ['rules', '规则库'], ['audit', '审计日志']] as const).map(([key, text]) => <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => selectTab(key)}>{text}</button>)}</nav>
    {tab === 'create' && <form className="management-form" onSubmit={submitBattle}>
      <label>对抗主题<input aria-label="对抗主题" list="admin-theme-options" value={topic} maxLength={200} placeholder="选择预置主题，或直接输入自定义主题" onChange={(event) => setTopic(event.target.value)} /><datalist id="admin-theme-options">{[...PRESET_THEMES, ...customThemes].map((item) => <option key={item} value={item} />)}</datalist><small className="field-note">预置 {PRESET_THEMES.length} 个 · 自定义 {customThemes.length} 个（与前台主题库共用，前台刷新后可见）</small></label>
      <details className="theme-library-inline" role="group" aria-label="主题库">
        <summary className="theme-library-summary"><span>主题库</span><small>{PRESET_THEMES.length + customThemes.length} 个主题，可直接带入创建</small></summary>
        <div className="theme-library-content">
          <div className="management-toolbar"><input aria-label="新增主题" placeholder="输入新的对抗主题" value={newTheme} maxLength={200} onChange={(event) => setNewTheme(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); handleAddTheme() } }} /><button type="button" className="primary-action" onClick={handleAddTheme}>添加到主题库</button></div>
          <div className="theme-groups">
            <section><h3>预置主题 <span>{PRESET_THEMES.length} 个</span></h3><p className="field-note">与前台总控台保持一致，只读。点击任一项可直接带入创建战局。</p><div className="theme-chips">{PRESET_THEMES.map((item) => <button key={item} type="button" className="theme-chip" onClick={() => setTopic(item)}>{item}</button>)}</div></section>
            <section><h3>自定义主题 <span>{customThemes.length} 个</span></h3><p className="field-note">与前台共享，刷新前台后即可选到。</p>{customThemes.length ? <div className="theme-chips">{customThemes.map((item) => <span key={item} className="theme-chip editable"><button type="button" className="chip-label" onClick={() => setTopic(item)}>{item}</button><button type="button" className="chip-remove" aria-label={`删除主题 ${item}`} onClick={() => handleRemoveTheme(item)}>×</button></span>)}</div> : <p className="empty">暂无自定义主题</p>}</section>
          </div>
        </div>
      </details>
      <label>对抗难度<select aria-label="对抗难度" value={difficulty} onChange={(event) => setDifficulty(event.target.value as TacticLevel)}>{(['low', 'mid', 'high'] as TacticLevel[]).map((level) => <option key={level} value={level}>{DIFFICULTY_LABELS[level]}</option>)}</select></label>
      <label>演练回合数<select aria-label="演练回合数" value={rounds} onChange={(event) => setRounds(Number(event.target.value))}>{Array.from({ length: MAX_ROUNDS - MIN_ROUNDS + 1 }, (_, index) => MIN_ROUNDS + index).map((value) => <option key={value} value={value}>{value} 回合</option>)}</select><small className="field-note">范围 {MIN_ROUNDS}~{MAX_ROUNDS} 回合，未选择默认 {DEFAULT_ROUNDS} 回合</small></label>
      <button className="primary-action" disabled={busy} type="submit">{busy ? '创建中…' : '创建并启动战局'}</button>
      <div className="tactic-hint" aria-label="当前难度攻击手法"><strong>{DIFFICULTY_LABELS[difficulty]} · 该难度可用手法 {DIFFICULTY_TACTICS[difficulty].length} 项</strong><ul>{DIFFICULTY_TACTICS[difficulty].map((tactic) => <li key={tactic.title}><b>{tactic.title}</b>{tactic.detail}</li>)}</ul></div>
    </form>}
    {tab === 'samples' && <div className="management-content">{notice && <p className="management-notice" role="status">{notice}</p>}<div className="management-toolbar"><input aria-label="搜索样本" placeholder="搜索主题、内容或来源" value={sampleQuery} onChange={(event) => setSampleQuery(event.target.value)} /><button type="button" onClick={() => void loadSamples()}>查询样本</button><button type="button" onClick={() => void seedLibrary('samples')} disabled={busy}>载入内置示例</button><button type="button" className="primary-action" onClick={() => setDialog({ kind: 'sample', values: emptySample })}>新增样本</button></div><div className="management-list">{samples.length ? samples.map((item) => <article className="management-row" key={item.id}><div><strong>{item.topic}</strong><p>{item.content}</p><small>{item.source} · 使用 {item.useCount} 次</small></div><div className="row-actions"><button type="button" onClick={() => setDialog({ kind: 'sample', id: item.id, values: { topic: item.topic, content: item.content, source: item.source } })}>编辑</button><button type="button" className="danger" onClick={() => setDialog({ kind: 'delete-sample', id: item.id, label: item.topic })}>删除</button></div></article>) : <LibraryEmpty kind="sample" busy={busy} onSeed={() => void seedLibrary('samples')} />}</div></div>}
    {tab === 'rules' && <div className="management-content">{notice && <p className="management-notice" role="status">{notice}</p>}<div className="management-toolbar"><input aria-label="搜索规则" placeholder="搜索名称或匹配条件" value={ruleQuery} onChange={(event) => setRuleQuery(event.target.value)} /><button type="button" onClick={() => void loadRules()}>查询规则</button><button type="button" onClick={() => void seedLibrary('rules')} disabled={busy}>载入内置示例</button><button type="button" className="primary-action" onClick={() => setDialog({ kind: 'rule', values: emptyRule })}>新增规则</button></div><div className="management-list">{rules.length ? rules.map((item) => <article className="management-row" key={item.id}><div><strong>{item.name}</strong><p>{item.condition}</p><small>{item.action} · 命中 {item.hitCount} 次</small></div><div className="row-actions"><button type="button" onClick={() => setDialog({ kind: 'rule', id: item.id, values: { name: item.name, condition: item.condition, action: item.action } })}>编辑</button><button type="button" className="danger" onClick={() => setDialog({ kind: 'delete-rule', id: item.id, label: item.name })}>删除</button></div></article>) : <LibraryEmpty kind="rule" busy={busy} onSeed={() => void seedLibrary('rules')} />}</div></div>}
    {tab === 'audit' && <div className="management-content">
      <details className="audit-hint" role="group" aria-label="审计日志说明">
        <summary>怎么看这份日志</summary>
        <dl>{AUDIT_FIELD_HINTS.map(([label, text]) => <div key={label}><dt>{label}</dt><dd>{text}</dd></div>)}</dl>
        <p>「角色」「操作」支持模糊匹配：填 admin 或 样本 即可，不必输入完整事件名。时间按本地时区筛选。</p>
      </details>
      <div className="management-toolbar audit-filters">
        <label>开始时间<input aria-label="审计开始时间" type="datetime-local" value={auditFilters.from_time} onChange={(event) => setAuditFilters({ ...auditFilters, from_time: event.target.value })} /></label>
        <label>结束时间<input aria-label="审计结束时间" type="datetime-local" value={auditFilters.to_time} onChange={(event) => setAuditFilters({ ...auditFilters, to_time: event.target.value })} /></label>
        <input aria-label="审计用户筛选" placeholder="角色，如 admin" value={auditFilters.user} onChange={(event) => setAuditFilters({ ...auditFilters, user: event.target.value })} />
        <input aria-label="审计操作筛选" placeholder="操作，如 样本 / battle.created" value={auditFilters.operation} onChange={(event) => setAuditFilters({ ...auditFilters, operation: event.target.value })} />
        <label className="audit-http-toggle"><input aria-label="包含接口调用记录" type="checkbox" checked={auditFilters.includeHttp} onChange={(event) => setAuditFilters({ ...auditFilters, includeHttp: event.target.checked })} />包含接口调用记录</label>
        <button type="button" onClick={() => void loadAudit()}>查询日志</button>
      </div>
      <div className="management-list">
        {logs.length ? <>
          <p className="audit-count">共 {logs.length} 条，按时间倒序（最多 200 条）</p>
          {logs.map((log) => {
            const statusText = labelOf(log.status, AUDIT_STATUS_LABELS, log.status || '—')
            const entries = auditEntries(log.data)
            return <article className="management-row audit-row" key={log.id}>
              <div className="audit-head">
                <time dateTime={log.createdAt} title={log.createdAt}>{formatDateTime(log.createdAt)}</time>
                <strong>{labelOf(log.actorRole, ACTOR_LABELS, '未知来源')}</strong>
                <span className="audit-event">{labelOf(log.eventType, EVENT_LABELS, log.eventType)}</span>
                <span className={`audit-status audit-status-${log.status || 'unknown'}`} title={log.status}>{statusText}</span>
              </div>
              <p className="audit-summary">{auditSummary(log)}</p>
              {entries.length
                ? <div className="audit-data">{entries.map(([key, value]) => { const text = auditValue(value); return <span className="audit-kv" key={key} title={`${AUDIT_DATA_LABELS[key] ?? key}：${text}`}><b>{AUDIT_DATA_LABELS[key] ?? key}</b>{shorten(text)}</span> })}</div>
                : <div className="audit-data"><span className="audit-kv"><b>附注</b>无附加字段</span></div>}
            </article>
          })}
        </> : <p className="empty">暂无审计日志</p>}
      </div>
    </div>}
    {dialog?.kind === 'sample' && <div className="management-modal-backdrop"><div className="management-modal" role="dialog" aria-modal="true" aria-labelledby="sample-dialog-title"><h3 id="sample-dialog-title">{dialog.id ? '编辑样本' : '新增样本'}</h3><form onSubmit={submitSample}><label htmlFor="sample-topic">样本主题</label><input id="sample-topic" required value={dialog.values.topic} onChange={(event) => setDialog({ ...dialog, values: { ...dialog.values, topic: event.target.value } })} /><label htmlFor="sample-content">样本内容</label><textarea id="sample-content" required value={dialog.values.content} onChange={(event) => setDialog({ ...dialog, values: { ...dialog.values, content: event.target.value } })} />{!dialog.id && <><label htmlFor="sample-file">从文件导入样本内容</label><input id="sample-file" type="file" accept=".txt,.json,text/plain,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; void file.text().then((content) => setDialog((current) => current?.kind === 'sample' ? { ...current, values: { ...current.values, content, source: current.values.source || file.name } } : current)) }} /></>}<label htmlFor="sample-source">样本来源</label><input id="sample-source" required value={dialog.values.source} onChange={(event) => setDialog({ ...dialog, values: { ...dialog.values, source: event.target.value } })} /><div className="modal-actions"><button type="button" onClick={() => setDialog(null)}>取消</button><button className="primary-action" type="submit" disabled={busy}>保存样本</button></div></form></div></div>}
    {dialog?.kind === 'rule' && <div className="management-modal-backdrop"><div className="management-modal" role="dialog" aria-modal="true" aria-labelledby="rule-dialog-title"><h3 id="rule-dialog-title">{dialog.id ? '编辑规则' : '新增规则'}</h3><form onSubmit={submitRule}><label htmlFor="rule-name">规则名称</label><input id="rule-name" required value={dialog.values.name} onChange={(event) => setDialog({ ...dialog, values: { ...dialog.values, name: event.target.value } })} /><label htmlFor="rule-condition">匹配条件</label><textarea id="rule-condition" required value={dialog.values.condition} onChange={(event) => setDialog({ ...dialog, values: { ...dialog.values, condition: event.target.value } })} /><label htmlFor="rule-action">动作</label><select id="rule-action" value={dialog.values.action} onChange={(event) => setDialog({ ...dialog, values: { ...dialog.values, action: event.target.value as RuleValues['action'] } })}><option value="拦截">拦截</option><option value="放行">放行</option></select><div className="modal-actions"><button type="button" onClick={() => setDialog(null)}>取消</button><button className="primary-action" type="submit" disabled={busy}>保存规则</button></div></form></div></div>}
    {(dialog?.kind === 'delete-sample' || dialog?.kind === 'delete-rule') && <div className="management-modal-backdrop"><div className="management-modal" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title"><h3 id="delete-dialog-title">确认删除</h3><p>确定删除“{dialog.label}”？删除后不可恢复。</p><div className="modal-actions"><button type="button" onClick={() => setDialog(null)}>取消</button><button className="danger" type="button" disabled={busy} onClick={() => void confirmDelete()}>确认删除</button></div></div></div>}
  </section>
}

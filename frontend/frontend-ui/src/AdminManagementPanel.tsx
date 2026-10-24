import { useCallback, useEffect, useState } from 'react'
import {
  apiErrorMessage, createAdminBattle, createAdminRule, createAdminSample, deleteAdminRule, deleteAdminSample,
  listAdminAuditLogs, listAdminRules, listAdminSamples, updateAdminRule, updateAdminSample,
  type AdminAuditLog, type AdminBattle, type AdminRule, type AdminSample,
} from './adminApi'
import {
  DEFAULT_ROUNDS, DIFFICULTY_LABELS, DIFFICULTY_TACTICS, MAX_ROUNDS, MIN_ROUNDS, PRESET_THEMES,
  addCustomTheme, loadCustomThemes, removeCustomTheme, type TacticLevel,
} from './themes'
import { AUDIT_DATA_LABELS, EVENT_LABELS } from './adminLabels'

type ManagementTab = 'create' | 'themes' | 'samples' | 'rules' | 'audit'
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
const csv = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
/** 审计日志 data 的键值化渲染：不再把 JSON 整段甩给使用者。 */
const auditEntries = (data: unknown): [string, unknown][] => (data && typeof data === 'object' && !Array.isArray(data) ? Object.entries(data as Record<string, unknown>) : [])
const auditValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
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
  const [auditFilters, setAuditFilters] = useState({ from_time: '', to_time: '', user: '', operation: '' })
  const [dialog, setDialog] = useState<DialogState>(null)
  const loadSamples = useCallback(async (q = sampleQuery) => { try { setSamples((await listAdminSamples(q)).items) } catch (error) { onError(apiErrorMessage(error)) } }, [onError, sampleQuery])
  const loadRules = useCallback(async (q = ruleQuery) => { try { setRules((await listAdminRules(q)).items) } catch (error) { onError(apiErrorMessage(error)) } }, [onError, ruleQuery])
  const loadAudit = useCallback(async (filters = auditFilters) => { try { setLogs(await listAdminAuditLogs(filters)) } catch (error) { onError(apiErrorMessage(error)) } }, [auditFilters, onError])
  const selectTab = (next: ManagementTab) => { setTab(next); if (next === 'samples') void loadSamples(); if (next === 'rules') void loadRules() }
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
  return <section className="admin-module admin-management" aria-label="后台功能管理">
    <div className="module-head"><h2>后台功能管理</h2><div className="management-export"><button type="button" onClick={exportBattles}>导出 Excel（CSV）</button><button type="button" onClick={() => window.print()}>打印 / 导出 PDF</button></div></div>
    <nav className="management-tabs" aria-label="管理模块" role="tablist">{([['create', '创建战局'], ['themes', '主题库'], ['samples', '样本库'], ['rules', '规则库'], ['audit', '审计日志']] as const).map(([key, text]) => <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => selectTab(key)}>{text}</button>)}</nav>
    {tab === 'create' && <form className="management-form" onSubmit={submitBattle}>
      <label>对抗主题<input aria-label="对抗主题" list="admin-theme-options" value={topic} maxLength={200} placeholder="选择预置主题，或直接输入自定义主题" onChange={(event) => setTopic(event.target.value)} /><datalist id="admin-theme-options">{[...PRESET_THEMES, ...customThemes].map((item) => <option key={item} value={item} />)}</datalist><small className="field-note">预置 {PRESET_THEMES.length} 个 · 自定义 {customThemes.length} 个（与前台主题库共用，前台刷新后可见）</small></label>
      <label>对抗难度<select aria-label="对抗难度" value={difficulty} onChange={(event) => setDifficulty(event.target.value as TacticLevel)}>{(['low', 'mid', 'high'] as TacticLevel[]).map((level) => <option key={level} value={level}>{DIFFICULTY_LABELS[level]}</option>)}</select></label>
      <label>演练回合数<select aria-label="演练回合数" value={rounds} onChange={(event) => setRounds(Number(event.target.value))}>{Array.from({ length: MAX_ROUNDS - MIN_ROUNDS + 1 }, (_, index) => MIN_ROUNDS + index).map((value) => <option key={value} value={value}>{value} 回合</option>)}</select><small className="field-note">范围 {MIN_ROUNDS}~{MAX_ROUNDS} 回合，未选择默认 {DEFAULT_ROUNDS} 回合</small></label>
      <button className="primary-action" disabled={busy} type="submit">{busy ? '创建中…' : '创建并启动战局'}</button>
      <div className="tactic-hint" aria-label="当前难度攻击手法"><strong>{DIFFICULTY_LABELS[difficulty]} · 该难度可用手法 {DIFFICULTY_TACTICS[difficulty].length} 项</strong><ul>{DIFFICULTY_TACTICS[difficulty].map((tactic) => <li key={tactic.title}><b>{tactic.title}</b>{tactic.detail}</li>)}</ul></div>
    </form>}
    {tab === 'themes' && <div className="management-content">
      <div className="management-toolbar"><input aria-label="新增主题" placeholder="输入新的对抗主题" value={newTheme} maxLength={200} onChange={(event) => setNewTheme(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); handleAddTheme() } }} /><button type="button" className="primary-action" onClick={handleAddTheme}>添加到主题库</button></div>
      <div className="theme-groups">
        <section><h3>预置主题 <span>{PRESET_THEMES.length} 个</span></h3><p className="field-note">与前台总控台保持字符级一致，只读。点击任一项可直接带入创建战局。</p><div className="theme-chips">{PRESET_THEMES.map((item) => <button key={item} type="button" className="theme-chip" onClick={() => { setTopic(item); setTab('create') }}>{item}</button>)}</div></section>
        <section><h3>自定义主题 <span>{customThemes.length} 个</span></h3><p className="field-note">存于前台同名 localStorage 键（agentlab_my_themes），前台刷新后即可在下拉中选到。</p>{customThemes.length ? <div className="theme-chips">{customThemes.map((item) => <span key={item} className="theme-chip editable"><button type="button" className="chip-label" onClick={() => { setTopic(item); setTab('create') }}>{item}</button><button type="button" className="chip-remove" aria-label={`删除主题 ${item}`} onClick={() => handleRemoveTheme(item)}>×</button></span>)}</div> : <p className="empty">暂无自定义主题</p>}</section>
      </div>
    </div>}
    {tab === 'samples' && <div className="management-content"><div className="management-toolbar"><input aria-label="搜索样本" placeholder="搜索主题、内容或来源" value={sampleQuery} onChange={(event) => setSampleQuery(event.target.value)} /><button type="button" onClick={() => void loadSamples()}>查询样本</button><button type="button" className="primary-action" onClick={() => setDialog({ kind: 'sample', values: emptySample })}>新增样本</button></div><div className="management-list">{samples.length ? samples.map((item) => <article className="management-row" key={item.id}><div><strong>{item.topic}</strong><p>{item.content}</p><small>{item.source} · 使用 {item.useCount} 次</small></div><div className="row-actions"><button type="button" onClick={() => setDialog({ kind: 'sample', id: item.id, values: { topic: item.topic, content: item.content, source: item.source } })}>编辑</button><button type="button" className="danger" onClick={() => setDialog({ kind: 'delete-sample', id: item.id, label: item.topic })}>删除</button></div></article>) : <p className="empty">暂无攻击样本</p>}</div></div>}
    {tab === 'rules' && <div className="management-content"><div className="management-toolbar"><input aria-label="搜索规则" placeholder="搜索名称或匹配条件" value={ruleQuery} onChange={(event) => setRuleQuery(event.target.value)} /><button type="button" onClick={() => void loadRules()}>查询规则</button><button type="button" className="primary-action" onClick={() => setDialog({ kind: 'rule', values: emptyRule })}>新增规则</button></div><div className="management-list">{rules.length ? rules.map((item) => <article className="management-row" key={item.id}><div><strong>{item.name}</strong><p>{item.condition}</p><small>{item.action} · 命中 {item.hitCount} 次</small></div><div className="row-actions"><button type="button" onClick={() => setDialog({ kind: 'rule', id: item.id, values: { name: item.name, condition: item.condition, action: item.action } })}>编辑</button><button type="button" className="danger" onClick={() => setDialog({ kind: 'delete-rule', id: item.id, label: item.name })}>删除</button></div></article>) : <p className="empty">暂无防守规则</p>}</div></div>}
    {tab === 'audit' && <div className="management-content"><div className="management-toolbar audit-filters"><label>开始时间<input aria-label="审计开始时间" type="datetime-local" value={auditFilters.from_time} onChange={(event) => setAuditFilters({ ...auditFilters, from_time: event.target.value })} /></label><label>结束时间<input aria-label="审计结束时间" type="datetime-local" value={auditFilters.to_time} onChange={(event) => setAuditFilters({ ...auditFilters, to_time: event.target.value })} /></label><input aria-label="审计用户筛选" placeholder="用户角色" value={auditFilters.user} onChange={(event) => setAuditFilters({ ...auditFilters, user: event.target.value })} /><input aria-label="审计操作筛选" placeholder="操作类型" value={auditFilters.operation} onChange={(event) => setAuditFilters({ ...auditFilters, operation: event.target.value })} /><button type="button" onClick={() => void loadAudit()}>查询日志</button></div><div className="management-list">{logs.length ? logs.map((log) => <article className="management-row audit-row" key={log.id}><time>{log.createdAt}</time><strong>{log.actorRole || '未知用户'}</strong><span>{EVENT_LABELS[log.eventType] ?? log.eventType}</span><span>{log.status}</span>{auditEntries(log.data).length ? <div className="audit-data">{auditEntries(log.data).map(([key, value]) => <span className="audit-kv" key={key}><b>{AUDIT_DATA_LABELS[key] ?? key}</b>{auditValue(value)}</span>)}</div> : <div className="audit-data"><span className="audit-kv"><b>数据</b>{auditValue(log.data)}</span></div>}</article>) : <p className="empty">暂无审计日志</p>}</div></div>}
    {dialog?.kind === 'sample' && <div className="management-modal-backdrop"><div className="management-modal" role="dialog" aria-modal="true" aria-labelledby="sample-dialog-title"><h3 id="sample-dialog-title">{dialog.id ? '编辑样本' : '新增样本'}</h3><form onSubmit={submitSample}><label htmlFor="sample-topic">样本主题</label><input id="sample-topic" required value={dialog.values.topic} onChange={(event) => setDialog({ ...dialog, values: { ...dialog.values, topic: event.target.value } })} /><label htmlFor="sample-content">样本内容</label><textarea id="sample-content" required value={dialog.values.content} onChange={(event) => setDialog({ ...dialog, values: { ...dialog.values, content: event.target.value } })} />{!dialog.id && <><label htmlFor="sample-file">从文件导入样本内容</label><input id="sample-file" type="file" accept=".txt,.json,text/plain,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; void file.text().then((content) => setDialog((current) => current?.kind === 'sample' ? { ...current, values: { ...current.values, content, source: current.values.source || file.name } } : current)) }} /></>}<label htmlFor="sample-source">样本来源</label><input id="sample-source" required value={dialog.values.source} onChange={(event) => setDialog({ ...dialog, values: { ...dialog.values, source: event.target.value } })} /><div className="modal-actions"><button type="button" onClick={() => setDialog(null)}>取消</button><button className="primary-action" type="submit" disabled={busy}>保存样本</button></div></form></div></div>}
    {dialog?.kind === 'rule' && <div className="management-modal-backdrop"><div className="management-modal" role="dialog" aria-modal="true" aria-labelledby="rule-dialog-title"><h3 id="rule-dialog-title">{dialog.id ? '编辑规则' : '新增规则'}</h3><form onSubmit={submitRule}><label htmlFor="rule-name">规则名称</label><input id="rule-name" required value={dialog.values.name} onChange={(event) => setDialog({ ...dialog, values: { ...dialog.values, name: event.target.value } })} /><label htmlFor="rule-condition">匹配条件</label><textarea id="rule-condition" required value={dialog.values.condition} onChange={(event) => setDialog({ ...dialog, values: { ...dialog.values, condition: event.target.value } })} /><label htmlFor="rule-action">动作</label><select id="rule-action" value={dialog.values.action} onChange={(event) => setDialog({ ...dialog, values: { ...dialog.values, action: event.target.value as RuleValues['action'] } })}><option value="拦截">拦截</option><option value="放行">放行</option></select><div className="modal-actions"><button type="button" onClick={() => setDialog(null)}>取消</button><button className="primary-action" type="submit" disabled={busy}>保存规则</button></div></form></div></div>}
    {(dialog?.kind === 'delete-sample' || dialog?.kind === 'delete-rule') && <div className="management-modal-backdrop"><div className="management-modal" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title"><h3 id="delete-dialog-title">确认删除</h3><p>确定删除“{dialog.label}”？删除后不可恢复。</p><div className="modal-actions"><button type="button" onClick={() => setDialog(null)}>取消</button><button className="danger" type="button" disabled={busy} onClick={() => void confirmDelete()}>确认删除</button></div></div></div>}
  </section>
}

// 复现真实后端事件顺序，验证：逐层释放粒子 / 上一层破碎 / 拦截即结束 / 播放节奏
import { chromium } from 'playwright'

const URL = process.env.SMOKE_URL || 'http://localhost:4174/'
const CHECK = [['L0-1', 'L0-2', 'L0-3'], ['L1-1', 'L1-2', 'L1-3'], ['L2-1', 'L2-2', 'L2-3', 'L2-4', 'L2-5'], ['L3-1', 'L3-2', 'L3-3', 'L3-4']]

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
const warns = []
page.on('console', (m) => { const t = m.text(); if (/\[3D\]/.test(t)) warns.push(t) })
page.on('pageerror', (e) => warns.push('ERR ' + e.message))
await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
await page.evaluate(() => {
  const c = document.getElementById('coverLayer')
  c.classList.add('hidden'); c.style.display = 'none'
})

await page.evaluate(() => {
  window.__trace = []
  let last = ''
  window.__sampler = setInterval(() => {
    const d = window.__battle3dDebug
    if (!d) return
    const s = d.state()
    const broken = d.shells().map((x) => (x && x.userData.broken ? 1 : 0)).join('')
    const line = `L${s.activeLayer} blocked=${s.blockedLayer} broken=${broken} sats=${s.sats.map((a) => a.length).join(',')}`
    if (line !== last) { last = line; window.__trace.push(line) }
  }, 120)
})

const runRound = async (blockAt, waitMs) => {
  await page.evaluate(({ blockAt, CHECK }) => {
    const B = window.BattleEventBus
    B.reset(null)
    B.setMode('live')
    let n = 0
    const emit = (type, payload, status, sid) => B.emit({
      type, round: 1, stageId: sid || '', payload: payload || {},
      status: status || '', source: 'live', mock: false, eventId: type + '-' + (++n),
    })
    emit('battle_started', { roundLimit: 3 })
    emit('round_started', { round: 1 })
    CHECK.forEach((ids, li) => {
      const base = { layerIndex: li, layer: 'L' + li, applicableChecks: ids }
      emit('layer_started', base, 'running', 'L' + li)
      emit('layer_started', base, 'running', 'L' + li) // 后端同时发 arbiter./defense. 两条
      ids.forEach((sid, ci) => {
        const blocked = blockAt && blockAt.li === li && blockAt.ci === ci
        emit('stage_started', { layerIndex: li, checkIndex: ci }, 'running', sid)
        emit('layer_verdict', { layerIndex: li, checkIndex: ci, status: blocked ? 'blocked' : 'passed' }, blocked ? 'blocked' : 'passed', sid)
        if (blocked) {
          for (let k = ci + 1; k < ids.length; k++) emit('layer_verdict', { layerIndex: li, status: 'skipped-by-block' }, 'skipped-by-block', ids[k])
        }
      })
    })
    if (blockAt) emit('arbiter_verdict', { classification: 'blocked' }, 'blocked', '')
    else emit('arbiter_verdict', { classification: 'full-penetration' }, 'passed', '')
    emit('round_settled', { classification: blockAt ? 'blocked' : 'full-penetration' })
  }, { blockAt, CHECK })
  await page.waitForTimeout(waitMs)
  return page.evaluate(() => {
    const s = window.__battle3dDebug.state()
    const trace = window.__trace.slice()
    window.__trace = []
    return {
      phase: s.phase, activeLayer: s.activeLayer, blocked: s.blockedLayer, classification: s.classification,
      sats: s.sats.map((a) => a.length),
      broken: window.__battle3dDebug.shells().map((x) => (x && x.userData.broken)),
      visible: window.__battle3dDebug.shells().map((x) => (x ? x.visible : null)),
      core: s.coreMode, trace,
    }
  })
}

console.log('===== 场景 A：L0~L3 全部通过（full-penetration）=====')
const a = await runRound(null, 16000)
console.log('  轨迹:'); a.trace.forEach((l) => console.log('    ', l))
console.log('  结果:', JSON.stringify({ activeLayer: a.activeLayer, sats: a.sats, broken: a.broken, visible: a.visible, core: a.core }))

console.log('===== 场景 B：L1-2 拦截（回合立即结束）=====')
const b = await runRound({ li: 1, ci: 1 }, 11000)
console.log('  轨迹:'); b.trace.forEach((l) => console.log('    ', l))
console.log('  结果:', JSON.stringify({ activeLayer: b.activeLayer, blocked: b.blocked, sats: b.sats, broken: b.broken, visible: b.visible, core: b.core }))

console.log('===== 3D 警告 =====')
warns.slice(0, 20).forEach((w) => console.log('  ', w))
await browser.close()

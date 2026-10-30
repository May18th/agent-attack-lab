#!/usr/bin/env node
/**
 * 攻防实验室 · 3D 动画演示 / 验收脚本（合并原 smoke-timeline / shot-3d / verify-init / verify-prod）
 *
 * 3D 动画的唯一驱动源是「回合时间线事件卡」（window 事件 battle-timeline:card）。
 * 本脚本因此有两种驱动方式：
 *   scenarios —— 直接按真实时间线顺序投递卡片，逐帧断言 3D 状态，覆盖全部 5 种结局
 *                （L0 拦截 / L2 拦截 / L3 控制成功 contained / 全穿透融核变红 / 新源回收）
 *   demo      —— 走页面真实演示流（准备弹窗 → 开始攻防 → mock 回合时间线），
 *                验证「卡片出现即动画」在整局中不丢帧、不越层
 *   prod      —— 线上健康检查：构建标记、JS 错误、卡片 → 3D 是否生效
 *
 * 用法：
 *   node scripts/verify-3d.mjs                                  # 本地 dev(4174) 跑卡片剧本
 *   node scripts/verify-3d.mjs --mode demo --diff high --shots   # 整局演示 + 关键帧截图
 *   node scripts/verify-3d.mjs --mode prod --shots               # 线上验收
 *   node scripts/verify-3d.mjs --url http://localhost:4173/      # 指定目标
 *   node scripts/verify-3d.mjs --headed                          # 打开浏览器看动画（演示用）
 *
 * 退出码 0 = 全部断言通过；1 = 有失败项（便于 CI / 部署后自动验收）。
 */
import { chromium } from 'playwright'
import fs from 'node:fs'

/* ---------------- 参数 ---------------- */
const argv = process.argv.slice(2)
function arg(name, fallback) {
  const i = argv.indexOf('--' + name)
  if (i < 0) return fallback
  const v = argv[i + 1]
  return v && !v.startsWith('--') ? v : true
}
const MODE = String(arg('mode', 'scenarios'))
const URL_ = String(arg('url', MODE === 'prod' ? 'https://www.yuanyiagentzhandui.cn/' : 'http://localhost:4174/'))
const shotsArg = arg('shots', null)
const SHOT_DIR = shotsArg ? (shotsArg === true ? 'shots' : String(shotsArg)) : null
const DIFF = String(arg('diff', 'high'))
const PACE = Number(arg('pace', 0)) || 0
const HEADED = arg('headed', false) === true
const KEEP = arg('keep', false) === true

if (SHOT_DIR) fs.mkdirSync(SHOT_DIR, { recursive: true })

/* ---------------- 断言与输出 ---------------- */
const results = []
function check(name, ok, detail) {
  results.push({ name, ok })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' · ' + detail : ''}`)
  return ok
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/* ---------------- 浏览器 ---------------- */
const browser = await chromium.launch({ channel: 'chrome', headless: !HEADED })
const context = await browser.newContext({ viewport: { width: 1600, height: 950 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => {
  if (m.type() === 'error' && !/Failed to load resource|net::ERR_FAILED/.test(m.text())) {
    errors.push('console: ' + m.text().slice(0, 160))
  }
})

console.log(`\n▶ 目标 ${URL_} · 模式 ${MODE}${SHOT_DIR ? ' · 截图 ' + SHOT_DIR : ''}\n`)

/* ---------------- 页面工具 ---------------- */
async function boot({ blockLiveModule = false } = {}) {
  if (blockLiveModule) await page.route('**/src/command-center.ts*', (r) => r.abort())
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForFunction(() => !!window.__battle3dDebug, null, { timeout: 60000 })
  await page.evaluate(() => {
    const c = document.getElementById('coverLayer')
    if (c) c.classList.add('hidden')
  })
  await wait(500)
}

const state = () =>
  page.evaluate(() => {
    const d = window.__battle3dDebug
    if (!d) return null
    const s = d.state()
    return {
      round: s.round,
      phase: s.phase,
      activeLayer: s.activeLayer,
      layerStarted: s.layerStarted,
      blockedLayer: s.blockedLayer,
      coreMode: s.coreMode,
      classification: s.classification,
      payloadState: s.payloadState,
      payloadRecycled: s.payloadRecycled,
      sourceType: s.sourceType,
      l3Expanded: s.l3Expanded,
      confirmedLayers: s.confirmedLayers.slice(),
      checks: s.checkResult.map((x) => Object.keys(x || {}).length),
      verdicts: s.checkResult.map((x) => ({ ...(x || {}) })),
      satellites: (s.sats || []).map((x) => x.length),
      fx: d.fxCount(),
      shell3Scale: d.shells()[3] ? +d.shells()[3].scale.x.toFixed(3) : null,
      shell3Broken: d.shells()[3] ? !!d.shells()[3].userData.broken : null,
    }
  })

const card = (c) =>
  page.evaluate((detail) => {
    window.dispatchEvent(new CustomEvent('battle-timeline:card', { detail }))
  }, c)

const newRound = (round, total = 3) =>
  page.evaluate(
    ({ round, total }) => {
      window.dispatchEvent(new CustomEvent('battle-timeline:round', { detail: { round, total } }))
    },
    { round, total },
  )

async function shot(name) {
  if (!SHOT_DIR) return
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, clip: { x: 0, y: 0, width: 1600, height: 950 } })
}

/* A1→A7：建立 payload 并提交到 L0（与真实时间线同一套卡片文案） */
async function preparePayload(round, source) {
  const sim = source === 'same' ? 'same-source · 相似度 0.93' : 'new-source · 相似度 0.62'
  const cards = [
    ['att', 'A1 · 读取战局配置', '核验规则版本、授权范围与回合号。'],
    ['att', 'A2 · 选择样本与攻击面', 'sampleId：SYNTH-0' + round + ' · 目标组件：权限接口'],
    ['att', 'A3 · 选择意图和策略', '意图：越权访问 · 策略：R' + round + '-strategy'],
    ['att', 'A4 · 构建合成 Payload', '结构字段与预期效果已填写，快照待校验。'],
    ['att', 'A5 · 授权与格式自检', '真实凭据、真实目标、长度、编码全部通过。', 'passed'],
    ['judge', 'A6 · 相似度源数据校验', sim],
    ['att', 'A7 · 正式提交', '冻结快照并生成 submissionId；payload 飞向 L0。', 'passed'],
  ]
  for (const [side, title, description, status] of cards) {
    await card({ round, side, title, description, status: status || '' })
    await wait(120)
  }
  await wait(900)
}

/* 逐项检查卡：passed / blocked 由 status 决定 */
async function runCheck(round, li, ci, status, name) {
  await card({
    round,
    side: 'def',
    title: `L${li}-${ci + 1} · ${name || '检测点'}`,
    description: status === 'blocked' ? '命中检测规则 · 正确阻断' : '检测状态：completed',
    status: status || 'passed',
  })
  await wait(620)
}

async function layerStart(round, li) {
  await card({
    round,
    side: 'judge',
    title: `L${li} · Arbiter 开启层检测`,
    description: `Defender 立即释放 L${li} 各环节标签粒子；适用检查 ${
      [[0, 3], [1, 3], [2, 5], [3, 4]].find((x) => x[0] === li)[1]
    } 项。`,
  })
  await wait(520)
}

async function penetrate(round, li) {
  await card({
    round,
    side: 'att',
    title: `L${li} 已穿透`,
    description: `本层全部环节通过，payload 来到下一层 L${li + 1}；防御球层破裂。`,
    status: 'passed',
  })
  await wait(1100)
}

/* ============================================================
   模式一：scenarios —— 卡片驱动的 5 种结局
   ============================================================ */
async function runScenarios() {
  await boot()
  const init = await page.evaluate(() => ({
    bus: typeof window.BattleEventBus,
    dbg: typeof window.__battle3dDebug,
    start: !!document.getElementById('btnStart'),
  }))
  console.log('初始化')
  check('BattleEventBus / 3D 调试接口就绪', init.bus === 'object' && init.dbg === 'object', JSON.stringify(init))
  check('页面无加载期 JS 错误', errors.length === 0, errors[0] || '无')

  let round = 0

  /* --- 剧本 1：L0 第 2 项拦截（新源 → 粒子飞向 Defender 更新特征库） --- */
  round++
  await newRound(round)
  await preparePayload(round, 'new')
  await layerStart(round, 0)
  let s = await state()
  check('S1 开启 L0 → 立即释放 3 枚标签粒子', s.layerStarted === 0 && s.satellites[0] === 3, JSON.stringify(s.satellites))
  await runCheck(round, 0, 0, 'passed', '基础黑名单')
  await runCheck(round, 0, 1, 'blocked', '权限边界校验')
  await wait(700)
  await shot('01-L0拦截-新源回收')
  s = await state()
  check(
    'S1 L0 第 2 项拦截生效（后续项标记 skipped-by-block）',
    s.blockedLayer === 0 && s.verdicts[0]['L0-2'] === 'blocked' && s.verdicts[0]['L0-3'] === 'skipped-by-block',
    `${s.blockedLayer} ${JSON.stringify(s.verdicts[0])}`,
  )
  check('S1 payload 已粒子化并回收', s.payloadRecycled === true && s.sourceType === 'new-source', `${s.sourceType}/${s.payloadRecycled}`)
  check('S1 拦截特效已生成（Core 光波 + 碎片）', s.fx > 0, `fx=${s.fx}`)

  /* --- 剧本 2：L1、L2 全通过后在 L2 第 4 项拦截（同源 → 原地飞散） --- */
  round++
  await newRound(round)
  await preparePayload(round, 'same')
  for (const li of [0, 1]) {
    await layerStart(round, li)
    for (let ci = 0; ci < [3, 3][li]; ci++) await runCheck(round, li, ci, 'passed')
    await penetrate(round, li)
  }
  await layerStart(round, 2)
  s = await state()
  check('S2 开启 L2 → 释放 5 枚标签粒子', s.activeLayer === 2 && s.satellites[2] === 5, JSON.stringify(s.satellites))
  await shot('02-L2粒子环')
  for (let ci = 0; ci < 3; ci++) await runCheck(round, 2, ci, 'passed')
  await runCheck(round, 2, 3, 'blocked', '隔离模拟·权限写入')
  await wait(700)
  await shot('03-L2拦截-同源飞散')
  s = await state()
  check('S2 L2 拦截，L0/L1 已逐层穿透', s.blockedLayer === 2 && s.checks[0] === 3 && s.checks[1] === 3, `L0=${s.checks[0]} L1=${s.checks[1]} L2=${s.checks[2]}`)
  check('S2 同源 payload 原地粒子化（不飞向 Defender）', s.sourceType === 'same-source' && s.payloadRecycled === true, s.sourceType)

  /* --- 剧本 3：L0-L2 穿透，L3 球壳膨胀 + L3-3 控制成功 → contained --- */
  round++
  await newRound(round)
  await preparePayload(round, 'new')
  for (const li of [0, 1, 2]) {
    await layerStart(round, li)
    for (let ci = 0; ci < [3, 3, 5][li]; ci++) await runCheck(round, li, ci, 'passed')
    await penetrate(round, li)
  }
  await layerStart(round, 3)
  await wait(700)
  s = await state()
  check('S3 L3 球壳膨胀（scale≈1.14）', s.l3Expanded === true && s.shell3Scale > 1.1, `scale=${s.shell3Scale}`)
  await shot('04-L3膨胀')
  await runCheck(round, 3, 0, 'passed', '全链路审计')
  await runCheck(round, 3, 1, 'passed', '异常监测')
  await shot('05-L3内收光波')
  await runCheck(round, 3, 2, 'blocked', '应急控制与恢复')
  await wait(700)
  s = await state()
  check('S3 L3-3 控制成功 → payload 粒子化回收', s.blockedLayer === 3 && s.payloadRecycled === true, `blockedLayer=${s.blockedLayer}`)
  await card({ round, side: 'judge', title: 'Arbiter · 最终分类', description: 'contained：L3 规定窗口内完成隔离与恢复。' })
  await wait(900)
  s = await state()
  check('S3 裁决 contained → Core 保持蓝色', s.classification === 'contained' && s.coreMode === 'blue', s.coreMode)

  /* --- 剧本 4：全穿透 → 融核、L3 破碎、Core 变红、安全对照 --- */
  round++
  await newRound(round)
  await preparePayload(round, 'new')
  for (const li of [0, 1, 2]) {
    await layerStart(round, li)
    for (let ci = 0; ci < [3, 3, 5][li]; ci++) await runCheck(round, li, ci, 'passed')
    await penetrate(round, li)
  }
  await layerStart(round, 3)
  for (let ci = 0; ci < 4; ci++) await runCheck(round, 3, ci, 'passed')
  await penetrate(round, 3)
  s = await state()
  check('S4 L3 穿透 → 球壳破裂 + payload 融核', s.shell3Broken === true && s.payloadRecycled === true, `broken=${s.shell3Broken}`)
  await card({ round, side: 'judge', title: 'Arbiter · 最终分类', description: 'full-penetration：攻击效果在控制窗口结束后仍存在。' })
  await wait(900)
  s = await state()
  check('S4 裁决 full-penetration → Core 变红', s.classification === 'full-penetration' && s.coreMode === 'red', s.coreMode)
  await shot('06-全穿透融核变红')

  await card({ round, side: 'judge', title: 'Arbiter · 启动安全对照', description: '独立轨道 · 不占攻击回合。' })
  await card({ round, side: 'def', title: 'D-07 · 安全对照结果', description: '正常样本完成必要检测并被正确放行。', status: 'passed' })
  await wait(600)
  await shot('07-安全对照')
  const safe = await page.evaluate(() => !!window.__battle3dDebug.state().safe)
  check('S4 安全对照独立轨道已生成', safe === true)

  await card({ round, side: 'judge', title: '本回合结算', description: 'Arbiter 完成裁决，评分入账。' })
  await wait(400)
  check('全剧本无运行时错误', errors.length === 0, errors[0] || '无')
}

/* ============================================================
   模式二：demo —— 页面真实演示流（准备弹窗 → 开始攻防）
   ============================================================ */
async function runDemo() {
  await boot({ blockLiveModule: true })
  if (PACE > 0) await page.evaluate((p) => { window.__demoPace = p }, PACE)

  await page.evaluate(() => { const b = document.getElementById('btnReady'); if (b) b.disabled = false })
  await page.click('#btnReady')
  await wait(400)
  await page.evaluate((idx) => {
    const input = document.getElementById('themeInput')
    if (input) {
      input.value = '提示注入与边界绕过演练'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const cards = document.querySelectorAll('#diffGrid > *')
    if (cards[idx]) cards[idx].click()
  }, { low: 0, mid: 1, high: 2 }[DIFF] ?? 2)
  await wait(300)

  // 记录时间线卡片与 3D 状态轨迹，用于验证「卡片出现 → 动画发生」的对应关系
  await page.evaluate(() => {
    window.__trace = []
    window.__cards = []
    window.addEventListener('battle-timeline:card', (ev) => {
      const d = ev.detail || {}
      if (/开启层检测/.test(d.title || '') || /已穿透/.test(d.title || '')) {
        window.__cards.push(`${d.round}|${d.title}`)
      }
    })
    let last = ''
    setInterval(() => {
      const d = window.__battle3dDebug
      if (!d) return
      const s = d.state()
      const sig = [
        s.round, s.activeLayer, s.blockedLayer, s.coreMode, s.classification,
        (s.sats || []).map((x) => x.length).join('/'),
        s.checkResult.map((x) => Object.keys(x || {}).length).join('/'),
      ].join('|')
      if (sig !== last) {
        last = sig
        window.__trace.push({ t: Date.now(), sig })
      }
    }, 90)
    window.__t0 = Date.now()
  })

  await page.click('#btnStart')
  console.log(`演示已启动（难度 ${DIFF}${PACE ? ' · pace ' + PACE : ''}），等待整局结算…`)

  let finished = true
  try {
    await page.waitForFunction(
      () => (document.getElementById('tlContent')?.textContent || '').includes('整局结算'),
      null,
      { timeout: 240000 },
    )
  } catch {
    finished = false
  }

  const text = await page.evaluate(() => document.getElementById('tlContent')?.textContent || '')
  const cards = await page.evaluate(() => window.__cards || [])
  const trace = await page.evaluate(() => window.__trace || [])
  const states = trace.map((x) => ({ ...x, p: x.sig.split('|') }))

  check('整局演示跑完（出现「整局结算」）', finished, finished ? '' : '超时')
  check('时间线出现「开启层检测」卡', /开启层检测/.test(text))
  check('时间线出现「已穿透」卡', /已穿透/.test(text))
  check('时间线出现「本回合评分」卡', /本回合评分/.test(text))

  const maxLayer = Math.max(0, ...states.map((x) => Number(x.p[1])))
  const blocked = states.some((x) => Number(x.p[2]) >= 0 && x.p[2] !== '-1')
  const red = states.some((x) => x.p[3] === 'red')

  if (DIFF === 'high') {
    check('逐层推进到 L3', maxLayer === 3, 'maxLayer=' + maxLayer)
    check('出现 Core 变红（全穿透融核）', red)
  } else {
    check('出现拦截（blockedLayer 命中）', blocked)
  }
  check('整局无 JS 错误', errors.length === 0, errors[0] || '无')

  if (SHOT_DIR) {
    // 尾帧：整局结束后的最终画面
    await page.screenshot({ path: `${SHOT_DIR}/demo-final.png`, clip: { x: 0, y: 0, width: 1600, height: 950 } })
  }
  console.log(`\n  卡片（${cards.length}）：`)
  cards.slice(0, 24).forEach((c) => console.log('    ' + c))
  console.log(`  3D 状态变化 ${states.length} 次，涉及层 ${[...new Set(states.map((x) => x.p[1]))].join('/')}`)
}

/* ============================================================
   模式三：prod —— 线上健康检查 + 卡片驱动 3D 冒烟
   ============================================================ */
async function runProd() {
  await boot()
  const info = await page.evaluate(() => ({
    title: document.title,
    bus: typeof window.BattleEventBus,
    dbg: typeof window.__battle3dDebug,
    start: !!document.getElementById('btnStart'),
    markers: {
      cardEvent: (document.documentElement.outerHTML.match(/battle-timeline:card/g) || []).length,
      timelineChannel: (document.documentElement.outerHTML.match(/channel:'timeline'/g) || []).length,
      penetrationCard: (document.documentElement.outerHTML.match(/已穿透/g) || []).length,
    },
  }))
  console.log('线上页面：', JSON.stringify(info.markers))
  check('页面标题正常', /实验室|攻防|COMMAND|CORE|指挥/i.test(info.title), info.title)
  check('3D 与事件总线已初始化', info.bus === 'object' && info.dbg === 'object')
  check('开始攻防按钮已注册', info.start === true)
  check('新构建标记齐全（卡片驱动 / timeline 通道）', info.markers.cardEvent >= 1 && info.markers.timelineChannel >= 1)
  check('页面无加载期 JS 错误', errors.length === 0, errors[0] || '无')

  await newRound(1)
  await card({ round: 1, side: 'judge', title: 'L0 · Arbiter 开启层检测', description: '线上冒烟' })
  await wait(600)
  let s = await state()
  check('线上卡片 → 3D 释放 L0 粒子', s.layerStarted === 0 && s.satellites[0] === 3, JSON.stringify(s.satellites))
  await card({ round: 1, side: 'def', title: 'L0-2 · 基础黑名单拦截', description: '命中黑名单特征词', status: 'blocked' })
  await wait(700)
  s = await state()
  check('线上卡片 → 3D 拦截生效', s.blockedLayer === 0, 'blockedLayer=' + s.blockedLayer)
  if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/prod-home.png`, clip: { x: 0, y: 0, width: 1600, height: 950 } })
}

/* ---------------- 执行 ---------------- */
let fatal = null
try {
  if (MODE === 'scenarios') await runScenarios()
  else if (MODE === 'demo') await runDemo()
  else if (MODE === 'prod') await runProd()
  else throw new Error('未知 --mode：' + MODE)
} catch (e) {
  fatal = e
  console.error('\n脚本异常：', e.message)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length ? '✗' : '✓'} 断言 ${results.length - failed.length}/${results.length} 通过`)
if (failed.length) failed.forEach((f) => console.log('  失败：' + f.name))

if (!KEEP) await browser.close()
process.exit(fatal || failed.length ? 1 : 0)

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import test, { after, before } from 'node:test'
import { chromium } from 'playwright'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '..')
const previewOrigin = 'http://127.0.0.1:4178'
const apiOrigin = 'http://127.0.0.1:8787'
const screenshotDir = resolve(projectRoot, '../../.superpowers/sdd/2026-10-25-restore-command-center')
const longBattleId = 'battle-' + 'id-segment-'.repeat(9)
const longTopic = '移动端长主题验收：' + '真实 API 返回的长标题与未知 Agent 来源需要自然换行，不能撑破总控台卡片。'.repeat(2)
const longSample = '合成安全样本 · '.repeat(85)

const browserErrors = []
let browser
let preview

function battle(id, topic = longTopic) {
  return {
    id,
    difficulty: 'high',
    topic,
    status: 'completed',
    createdAt: '2026-10-25T08:30:00Z',
    attackerOut: {
      agentSource: 'future-agent-with-a-long-unrecognized-source-label',
      samples: Array.from({ length: 6 }, (_, index) => ({
        type: 'defect',
        topic,
        severity: 'high',
        content: `${index + 1}. ${longSample}`,
        simulation: true,
      })),
    },
    defenderOut: [{
      agentSource: 'acp-rule-fallback',
      caught: [],
      risks: [],
      fixed: [],
      scopeNotice: '仅处理合成样本，不访问外部目标。',
    }],
  }
}

function score() {
  return {
    version: 'internal-agent-v2',
    status: 'scored',
    message: '分别衡量输出完整度与可审计性。',
    attacker: { status: 'scored', score: null, maxScore: 100, categories: [] },
    defender: { status: 'scored', score: null, maxScore: 100, categories: [] },
  }
}

function apiResponse(pathname, searchParams, method) {
  if (pathname.endsWith('/auth/session')) return { status: 200, body: { enabled: true, authenticated: false } }
  if (pathname.endsWith('/health')) return { status: 200, body: { status: 'ok' } }
  if (pathname.endsWith('/dashboard/summary')) return {
    status: 200,
    body: { totalBattles: 21, completedBattles: 19, failedBattles: 2, highDifficultyBattles: 8, sampleCount: 6, ruleHitCount: 0, riskCount: 0, recommendationCount: 0, simulationSampleCount: 6, acpCallBattles: 0, ruleLibraryCaseCount: 3 },
  }
  if (pathname.endsWith('/external-cases')) {
    const item = {
      externalId: 'CVE-2099-0001',
      vendorProject: 'Example Vendor',
      product: 'Example Gateway',
      title: '经核验的公开安全案例',
      dateAdded: '2026-10-11',
      description: '公开来源中的案例说明。'.repeat(8),
      requiredAction: 'Apply the fix',
      cwes: ['CWE-89'],
      sourceUrl: 'https://example.invalid/advisory',
      provenanceStatus: 'verified_primary',
      synthetic: false,
      recordKind: 'external_fact',
      source: { publisher: 'CISA', sourceType: 'known_exploited_vulnerabilities', catalogVersion: 'test-1', retrievedAt: '2026-10-11T00:00:00Z', contentSha256: 'a'.repeat(64) },
    }
    return { status: 200, body: { available: true, items: [item], total: 1, sourceCount: 1 } }
  }
  if (pathname === '/battles' && method !== 'POST') {
    const offset = Number(searchParams.get('offset') ?? 0)
    const rows = [battle(longBattleId), battle('battle-2', '历史中的第二场战局')]
    return { status: 200, headers: { 'X-Total-Count': '21' }, body: rows.slice(offset, offset + 10) }
  }
  if (pathname.includes('/battles/')) {
    const parts = pathname.split('/').filter(Boolean)
    const id = decodeURIComponent(parts[1] ?? '')
    if (parts[2] === 'score') return { status: 200, body: score() }
    if (method === 'GET') return { status: 200, body: battle(id, id === 'battle-test' ? '路由回放验收战局' : longTopic) }
  }
  return { status: 404, body: { detail: 'not found' } }
}

async function newPage(viewport) {
  const page = await browser.newPage({ viewport })
  const apiCalls = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === previewOrigin) return route.continue()
    if (url.origin === apiOrigin) {
      apiCalls.push({ pathname: url.pathname, method: route.request().method() })
      const result = apiResponse(url.pathname, url.searchParams, route.request().method())
      return route.fulfill({ status: result.status, headers: { 'Content-Type': 'application/json', ...(result.headers ?? {}) }, body: JSON.stringify(result.body) })
    }
    return route.abort()
  })
  return { page, apiCalls }
}

async function assertNoPageOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    pageRight: document.querySelector('.page')?.getBoundingClientRect().right ?? 0,
  }))
  assert.ok(metrics.documentScrollWidth <= metrics.clientWidth, `${label}: ${JSON.stringify(metrics)}`)
  assert.ok(metrics.bodyScrollWidth <= metrics.clientWidth, `${label}: ${JSON.stringify(metrics)}`)
  assert.ok(metrics.pageRight <= metrics.clientWidth + 1, `${label} page box exceeds viewport: ${JSON.stringify(metrics)}`)
}

async function startPreview() {
  const build = spawnSync(process.execPath, ['scripts/build.mjs'], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, CF_PAGES: '0', VITE_AGENT_API: '' },
  })
  assert.equal(build.status, 0, `actual front-end build failed:\n${build.stdout}\n${build.stderr}`)

  preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4178', '--strictPort'], {
    cwd: projectRoot,
    env: { ...process.env, CF_PAGES: '0', VITE_AGENT_API: '' },
    stdio: 'ignore',
    windowsHide: true,
  })

  let lastError
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (preview.exitCode !== null) throw new Error(`Vite preview exited early (${preview.exitCode})`)
    try {
      const response = await fetch(previewOrigin)
      if (response.ok) return
    } catch (error) { lastError = error }
    await delay(250)
  }
  throw new Error(`Vite preview did not become ready: ${String(lastError)}`)
}

before(async () => {
  mkdirSync(screenshotDir, { recursive: true })
  await startPreview()
  browser = await chromium.launch({ headless: true })
})

after(async () => {
  await browser?.close()
  if (preview && preview.exitCode === null) {
    preview.kill()
    await Promise.race([new Promise((resolveExit) => preview.once('exit', resolveExit)), delay(3000)])
  }
  assert.deepEqual(browserErrors, [], 'built page reported uncaught browser errors')
})

test('actual built public page remains usable without horizontal overflow at 390x844 and 1280x900', async () => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    const { page, apiCalls } = await newPage(viewport)
    try {
      await page.goto(previewOrigin, { waitUntil: 'networkidle' })
      await page.getByRole('heading', { name: longTopic, level: 2 }).waitFor()
      await page.getByRole('heading', { name: '内部运行质量评分' }).waitFor()
      await page.locator('.source-meta').getByText(/攻击来源：来源未知/).waitFor()
      await assertNoPageOverflow(page, `${viewport.width}x${viewport.height} initial`)

      const rounds = page.locator('.rounds-scroll')
      const roundDimensions = await rounds.evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }))
      assert.ok(roundDimensions.scrollHeight > roundDimensions.clientHeight, `round content should be independently scrollable: ${JSON.stringify(roundDimensions)}`)
      await rounds.evaluate((element) => { element.scrollTop = element.scrollHeight })
      assert.ok(await rounds.evaluate((element) => element.scrollTop > 0), 'long round details should scroll to later samples')
      assert.ok(await page.getByText(/证据不足/).count() > 0, 'empty score categories should render the explicit insufficient-evidence state')

      const externalDetails = page.locator('details.external-cases')
      await externalDetails.locator('summary').click()
      await externalDetails.getByRole('link', { name: '查看原始来源' }).waitFor()
      await externalDetails.getByRole('textbox', { name: '搜索外部案例' }).scrollIntoViewIfNeeded()
      await externalDetails.getByRole('button', { name: '查询' }).scrollIntoViewIfNeeded()
      await assertNoPageOverflow(page, `${viewport.width}x${viewport.height} expanded content`)

      await page.locator('.history .pagination').scrollIntoViewIfNeeded()
      for (const button of await page.locator('.history .pagination button').all()) {
        const box = await button.boundingBox()
        assert.ok(box && box.x >= 0 && box.x + box.width <= viewport.width, `pagination control outside viewport: ${JSON.stringify(box)}`)
      }
      const methodSet = new Set(apiCalls.map((call) => call.method))
      assert.ok(!apiCalls.some((call) => call.pathname.includes('/events')), 'public page must not request privileged event endpoints')
      assert.ok(![...methodSet].some((method) => method !== 'GET'), 'this read-only acceptance must not send writes')

      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({ path: resolve(screenshotDir, `command-center-${viewport.width}x${viewport.height}.png`) })
    } finally {
      await page.close()
    }
  }
})

test('replay deep links survive direct loads and refreshes; admin aliases remain isolated', async () => {
  for (const route of ['/replay/battle-test', '/?battle_id=battle-test']) {
    const { page, apiCalls } = await newPage({ width: 1280, height: 900 })
    try {
      await page.goto(`${previewOrigin}${route}`, { waitUntil: 'networkidle' })
      await page.getByRole('heading', { name: '路由回放验收战局', level: 2 }).waitFor()
      await assertNoPageOverflow(page, `deep link ${route}`)
      await page.reload({ waitUntil: 'networkidle' })
      await page.getByRole('heading', { name: '路由回放验收战局', level: 2 }).waitFor()
      assert.ok(apiCalls.some((call) => call.pathname.endsWith('/battles/battle-test')), `replay route was not restored: ${route}`)
      assert.ok(!apiCalls.some((call) => call.pathname.includes('/events') || call.method !== 'GET'))
    } finally {
      await page.close()
    }
  }

  for (const route of ['/admin', '/dashboard']) {
    const { page, apiCalls } = await newPage({ width: 1280, height: 900 })
    try {
      await page.goto(`${previewOrigin}${route}`, { waitUntil: 'networkidle' })
      await page.getByRole('heading', { name: '管理员后台 - 管理员认证' }).waitFor()
      assert.equal(await page.getByRole('textbox', { name: '后台管理密码' }).count(), 1)
      assert.ok(!await page.getByRole('heading', { name: '智能体攻防战局总控台' }).count())
      assert.ok(!apiCalls.some((call) => call.method !== 'GET'), `${route} made a write during route acceptance`)
      await page.screenshot({ path: resolve(screenshotDir, `admin-entry-${route.slice(1)}.png`) })
    } finally {
      await page.close()
    }
  }
})

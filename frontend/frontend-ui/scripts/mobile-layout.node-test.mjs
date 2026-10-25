import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { chromium } from 'playwright'

const css = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')
const baseCss = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

test('390px layout contract keeps primary tracks shrinkable and controls readable', () => {
  assert.match(css, /\.layout\s*,\s*\.col-left\s*,\s*\.detail\s*\{[^}]*min-width:0/)
  const mobileRules = css.slice(css.indexOf('@media(max-width:420px)'))
  assert.notEqual(mobileRules, css)
  assert.match(mobileRules, /\.diff-grid\{grid-template-columns:1fr/)
  assert.match(mobileRules, /\.pagination\{flex-wrap:wrap/)
  assert.match(baseCss, /input,\s*textarea,\s*select\s*\{\s*font-size:\s*16px/)
  assert.match(baseCss, /html\s*\{\s*-webkit-tap-highlight-color:\s*transparent/)
  assert.match(indexHtml, /name="viewport" content="[^"]*viewport-fit=cover/)
  assert.match(css, /safe-area-inset-top/)
  assert.match(css, /safe-area-inset-bottom/)
})

test('representative public shell has no horizontal overflow at 390px', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await page.setContent(`
      <style>${baseCss}\n${css}</style>
      <div class="page">
        <header class="topbar">
          <div><div class="eyebrow">智能体攻防实验室（AGENT ATTACK LAB）</div><h1>智能体<em>攻防实验室</em></h1></div>
          <div class="topbar-actions"><a class="admin-link" href="/admin">管理员后台</a><button class="status ok"><span class="dot"></span>服务运行正常（Service healthy）· 点击刷新检查</button></div>
        </header>
        <main class="layout"><div class="col-left"><section class="glass card"><div class="diff-grid"><label><input type="radio"><span class="diff-item"><b>高（High）</b><small>复合漏洞（Compound vulnerability）</small></span></label><label><input type="radio"><span class="diff-item"><b>中（Medium）</b><small>规则违规（Rule violation）</small></span></label><label><input type="radio"><span class="diff-item"><b>低（Low）</b><small>基础缺陷（Basic defect）</small></span></label></div></section></div><section class="glass card detail"><div class="detail-meta">battle-with-a-long-id-and-status</div></section></main>
        <div class="pagination"><button class="btn-ghost">上一页</button><span>第 1 / 1 页 · 每页 10 场</span><button class="btn-ghost">下一页</button></div>
      </div>
    `)
    const metrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
    }))
    assert.ok(metrics.scrollWidth <= metrics.clientWidth, JSON.stringify(metrics))
    assert.ok(metrics.bodyScrollWidth <= metrics.clientWidth, JSON.stringify(metrics))
  } finally {
    await browser.close()
  }
})

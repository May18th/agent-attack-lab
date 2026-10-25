import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const redirects = readFileSync(new URL('../public/_redirects', import.meta.url), 'utf8')

test('public root entry mounts the backend-connected React experience', () => {
  assert.match(html, /<script type="module" src="\/src\/main\.tsx"><\/script>/)
  assert.doesNotMatch(html, /var id='A-'/)
  assert.doesNotMatch(html, /事件回放 · Defender\/Arbiter 事件驱动 · 模拟计时/)
})

test('Pages routes the administrator aliases to the administrator entry', () => {
  assert.match(redirects, /^\/admin \/admin\/index\.html 200$/m)
  assert.match(redirects, /^\/admin\/\* \/admin\/index\.html 200$/m)
  assert.match(redirects, /^\/dashboard \/admin\/index\.html 200$/m)
  assert.match(redirects, /^\/dashboard\/\* \/admin\/index\.html 200$/m)
})

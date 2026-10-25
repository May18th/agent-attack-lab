import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const redirects = readFileSync(new URL('../public/_redirects', import.meta.url), 'utf8')

test('public root entry mounts the command center experience', () => {
  assert.match(html, /<title>智能体攻防实验室 · 总控台<\/title>/)
  assert.match(html, /<script type="module" src="\/src\/command-center\.ts"><\/script>/)
  assert.doesNotMatch(html, /<script type="module" src="\/src\/main\.tsx"><\/script>/)
})

test('Pages routes the administrator aliases to the administrator entry', () => {
  assert.match(redirects, /^\/admin \/admin\/ 302$/m)
  assert.match(redirects, /^\/dashboard \/admin\/ 302$/m)
  assert.match(redirects, /^\/dashboard\/ \/admin\/ 302$/m)
  assert.match(redirects, /^\/dashboard\/\* \/admin\/ 302$/m)
})

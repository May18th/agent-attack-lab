import assert from 'node:assert/strict'
import test from 'node:test'
import * as buildEnvironment from './build-environment.mjs'

const { configurePagesApi } = buildEnvironment

test('leaves non-Pages build configuration unchanged', () => {
  const env = { VITE_AGENT_API: 'https://custom-test.example' }

  assert.equal(configurePagesApi(env), null)
  assert.equal(env.VITE_AGENT_API, 'https://custom-test.example')
})

test('forces the production API on the main Pages branch', () => {
  const env = { CF_PAGES: '1', CF_PAGES_BRANCH: 'main', VITE_AGENT_API: 'https://preview-api.example' }

  assert.deepEqual(configurePagesApi(env), {
    branch: 'main',
    api: 'https://api.yuanyiagentzhandui.cn',
  })
  assert.equal(env.VITE_AGENT_API, 'https://api.yuanyiagentzhandui.cn')
})

test('forces the isolated API on Pages preview branches', () => {
  const env = { CF_PAGES: '1', CF_PAGES_BRANCH: 'codex/change', VITE_AGENT_API: 'https://api.yuanyiagentzhandui.cn' }

  assert.deepEqual(configurePagesApi(env), {
    branch: 'codex/change',
    api: 'https://preview-api.yuanyiagentzhandui.cn',
  })
  assert.equal(env.VITE_AGENT_API, 'https://preview-api.yuanyiagentzhandui.cn')
})

test('fails closed when a Pages build has no branch metadata', () => {
  assert.throws(
    () => configurePagesApi({ CF_PAGES: '1', VITE_AGENT_API: 'https://api.yuanyiagentzhandui.cn' }),
    /missing CF_PAGES_BRANCH/,
  )
})

test('forces the production API for an explicit production build', () => {
  assert.equal(typeof buildEnvironment.configureBuildApi, 'function')
  const env = { VITE_AGENT_API: 'https://preview-api.example' }

  assert.deepEqual(buildEnvironment.configureBuildApi({ env, args: ['--production'] }), {
    target: 'production',
    api: 'https://api.yuanyiagentzhandui.cn',
  })
  assert.equal(env.VITE_AGENT_API, 'https://api.yuanyiagentzhandui.cn')
})

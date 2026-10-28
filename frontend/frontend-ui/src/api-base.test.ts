import { describe, expect, it } from 'vitest'
import { resolveApiBase } from './api'

const PREVIEW = 'https://preview-api.yuanyiagentzhandui.cn'
const PRODUCTION = 'https://api.yuanyiagentzhandui.cn'

describe('resolveApiBase', () => {
  it('正式域名拿到 preview-api 时改回生产 API', () => {
    expect(resolveApiBase(PREVIEW, 'yuanyiagentzhandui.cn')).toBe(PRODUCTION)
    expect(resolveApiBase(PREVIEW, 'www.yuanyiagentzhandui.cn')).toBe(PRODUCTION)
  })

  it('正式域名用正确的生产 API 时原样保留', () => {
    expect(resolveApiBase(PRODUCTION, 'www.yuanyiagentzhandui.cn')).toBe(PRODUCTION)
  })

  it('预览子域保持隔离语义，不被改成生产 API', () => {
    expect(resolveApiBase(PREVIEW, 'preview-api.yuanyiagentzhandui.cn')).toBe(PREVIEW)
    expect(resolveApiBase(PREVIEW, 'abc.agent-attack-lab.pages.dev')).toBe(PREVIEW)
  })

  it('正式域名未注入时不猜测目标', () => {
    expect(resolveApiBase(undefined, 'www.yuanyiagentzhandui.cn')).toBe('')
    expect(resolveApiBase('   ', 'www.yuanyiagentzhandui.cn')).toBe('')
  })

  it('本地开发回落到本地后端', () => {
    expect(resolveApiBase(undefined, 'localhost')).toBe('http://127.0.0.1:8787')
    expect(resolveApiBase(undefined, '127.0.0.1')).toBe('http://127.0.0.1:8787')
  })

  it('去掉结尾斜杠，避免拼出双斜杠', () => {
    expect(resolveApiBase(`${PRODUCTION}/`, 'www.yuanyiagentzhandui.cn')).toBe(PRODUCTION)
    expect(resolveApiBase(`${PREVIEW}/`, 'yuanyiagentzhandui.cn')).toBe(PRODUCTION)
  })
})

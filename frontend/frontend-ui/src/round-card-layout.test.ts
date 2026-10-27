/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = readFileSync('index.html', 'utf8')

describe('逐轮数据条布局', () => {
  it('keeps the attacker and defender columns equal and shrinkable', () => {
    expect(page).toMatch(/\.round-body\{[^}]*grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/)
    expect(page).toMatch(/\.side\{[^}]*min-width:0/)
  })

  it('wraps long samples, tags, and defense findings inside their own columns', () => {
    expect(page).toMatch(/\.sample-copy\{[^}]*overflow-wrap:anywhere/)
    expect(page).toMatch(/\.code-chip\{[^}]*max-width:100%[^}]*overflow-wrap:anywhere/)
    expect(page).toMatch(/\.finding \.v\{[^}]*min-width:0[^}]*overflow-wrap:anywhere/)
  })
})

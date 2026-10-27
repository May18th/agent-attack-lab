import { describe, expect, it } from 'vitest'
import { buildBattleCreationPayload } from './command-center-config'

describe('command center battle configuration', () => {
  it('includes the user-selected round count in the battle creation payload', () => {
    expect(buildBattleCreationPayload('提示注入与输入校验', 'mid', '7')).toEqual({
      topic: '提示注入与输入校验',
      difficulty: 'mid',
      rounds: 7,
    })
  })

  it('defaults blank input to three rounds and clamps invalid values to the supported range', () => {
    expect(buildBattleCreationPayload('主题', 'low', '')).toEqual({ topic: '主题', difficulty: 'low', rounds: 3 })
    expect(buildBattleCreationPayload('主题', 'high', '2')).toEqual({ topic: '主题', difficulty: 'high', rounds: 3 })
    expect(buildBattleCreationPayload('主题', 'high', '99')).toEqual({ topic: '主题', difficulty: 'high', rounds: 10 })
  })
})

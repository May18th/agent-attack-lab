export type BattleDifficulty = 'low' | 'mid' | 'high'

const DEFAULT_ROUNDS = 3
const MIN_ROUNDS = 3
const MAX_ROUNDS = 10

export function normalizeRoundCount(value: string | number | null | undefined): number {
  if (value === null || value === undefined || String(value).trim() === '') return DEFAULT_ROUNDS
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed)) return DEFAULT_ROUNDS
  return Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, Math.trunc(parsed)))
}

export function buildBattleCreationPayload(topic: string, difficulty: BattleDifficulty, roundsInput: string | number | null | undefined) {
  return { topic, difficulty, rounds: normalizeRoundCount(roundsInput) }
}

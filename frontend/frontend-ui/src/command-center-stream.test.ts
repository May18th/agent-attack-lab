import { describe, expect, it } from 'vitest'
import { parseSseData, reconnectDelay } from './command-center-stream'

describe('command center SSE helpers', () => {
  it('parses backend event blocks', () => {
    expect(parseSseData<{ type: string }>('id: event-1\nevent: round.started\ndata: {"type":"round.started"}'))
      .toEqual({ type: 'round.started' })
  })

  it('joins multiple SSE data lines', () => {
    expect(parseSseData<{ value: number }>('data: {"value":\ndata: 3}')).toEqual({ value: 3 })
  })

  it.each(['', 'event: ping', 'data: not-json', 'data: null', 'data: 42'])(
    'ignores malformed or non-object data: %s',
    (block) => expect(parseSseData(block)).toBeNull(),
  )

  it('uses bounded exponential reconnect delays', () => {
    expect([0, 1, 2, 3, 4].map(reconnectDelay)).toEqual([1000, 2000, 4000, 5000, 5000])
  })
})

import { describe, expect, it } from 'vitest'
import { lift, step, withEvents, type OutcomeEvent } from './outcome'

const evtA: OutcomeEvent = { kind: 'city-recovered', cityId: 1 }
const evtB: OutcomeEvent = { kind: 'city-recovered', cityId: 2 }

describe('outcome 并列通道助手', () => {
  it('withEvents 缺省事件为空', () => {
    expect(withEvents(1)).toEqual({ state: 1, events: [] })
    expect(withEvents(1, [evtA])).toEqual({ state: 1, events: [evtA] })
  })

  it('lift 把纯 state→state 提升为产空事件步骤', () => {
    const inc = lift((n: number) => n + 1)
    expect(inc(5)).toEqual({ state: 6, events: [] })
  })

  it('step 施加产事件步骤并按序拼接事件', () => {
    const start = withEvents(0, [evtA])
    const next = step(start, (n) => withEvents(n + 1, [evtB]))
    expect(next).toEqual({ state: 1, events: [evtA, evtB] })
  })

  it('step 折叠多步：state 串行推进、事件按序累积', () => {
    const result = [lift((n: number) => n + 1), (n: number) => withEvents(n * 10, [evtB])].reduce(
      step,
      withEvents(2, [evtA])
    )
    expect(result).toEqual({ state: 30, events: [evtA, evtB] })
  })
})

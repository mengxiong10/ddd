import { describe, it, expect } from 'vitest'
import { createGameStore } from './game-store'
import type { OutcomeEvent } from '../core/shared/outcome'
import { createInitialState } from '../core/world/fixture'

const fixtureStore = (seed = 1) => createGameStore({ initialGame: createInitialState(seed) })

/** 取队列中首个该 kind 的事件载荷（无则 undefined）。 */
function findEvent(
  store: ReturnType<typeof createGameStore>,
  kind: OutcomeEvent['kind']
): OutcomeEvent | undefined {
  for (const f of store.getState().feedback) {
    if (f.payload.kind === 'event' && f.payload.event.kind === kind) return f.payload.event
  }
  return undefined
}

describe('game-store', () => {
  it('默认无对局且 feedback 为空', () => {
    const store = createGameStore()
    expect(store.getState().game).toBeNull()
    expect(store.getState().feedback).toEqual([])
  })

  it('无对局时 dispatch/canDispatch 抛程序错误', () => {
    const store = createGameStore()
    expect(() => store.getState().dispatch({ type: 'endMonth' })).toThrow(/game has not started/)
    expect(() => store.getState().canDispatch({ type: 'endMonth' })).toThrow(/game has not started/)
  })

  it('可显式注入 fixture，feedback 为空', () => {
    const store = fixtureStore()
    const { game, feedback } = store.getState()
    expect(game).not.toBeNull()
    if (!game) throw new Error('expected fixture game')
    expect(game.year).toBe(189)
    expect(game.month).toBe(1)
    expect(game.playerLordId).toBe(1)
    expect(feedback).toEqual([])
  })

  it('dispatch 即时指令成功：更新 game + 入队 develop-done 事件 + 返回 ok', () => {
    const store = fixtureStore()
    const before = store.getState().game!.cities[1]!.agriculture
    const result = store.getState().dispatch({ type: 'reclaim', officerId: 1 })
    expect(result.ok).toBe(true)
    expect(store.getState().game!.cities[1]!.agriculture).toBeGreaterThan(before)
    const ev = findEvent(store, 'develop-done')
    expect(ev?.kind).toBe('develop-done')
  })

  it('dispatch 失败：game 不变 + 入队 failure(reason) + 返回 ok:false', () => {
    const store = fixtureStore()
    const snapshot = store.getState().game
    const result = store.getState().dispatch({ type: 'reclaim', officerId: 999 })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('officer-not-found')
    expect(store.getState().game).toBe(snapshot)
    const item = store.getState().feedback.at(-1)!
    expect(item.payload.kind).toBe('failure')
    if (item.payload.kind === 'failure') {
      expect(item.payload.action).toBe('reclaim')
      expect(item.payload.reason).toBe('officer-not-found')
    }
  })

  it('dispatch 成功额外入队 issued 确认项（带完整 action）', () => {
    const store = fixtureStore()
    store.getState().dispatch({ type: 'reclaim', officerId: 1 })
    const issued = store.getState().feedback.find((f) => f.payload.kind === 'issued')
    expect(issued).toBeDefined()
    if (issued?.payload.kind === 'issued') {
      expect(issued.payload.action).toEqual({ type: 'reclaim', officerId: 1 })
    }
  })

  it('dispatch 失败不入队 issued（只入 failure）', () => {
    const store = fixtureStore()
    store.getState().dispatch({ type: 'reclaim', officerId: 999 })
    expect(store.getState().feedback.some((f) => f.payload.kind === 'issued')).toBe(false)
  })

  it('endMonth 推进月份；先掠夺再 endMonth → 队列含 plunder-done', () => {
    const store = fixtureStore()
    store.getState().dispatch({ type: 'plunder', officerId: 1 })
    store.getState().dispatch({ type: 'endMonth' })
    expect(store.getState().game!.month).toBe(2)
    expect(findEvent(store, 'plunder-done')?.kind).toBe('plunder-done')
  })

  it('canDispatch 返回 canApply 结果且不改状态', () => {
    const store = fixtureStore()
    const snapshot = store.getState().game
    expect(store.getState().canDispatch({ type: 'reclaim', officerId: 1 }).ok).toBe(true)
    expect(store.getState().canDispatch({ type: 'reclaim', officerId: 999 })).toEqual({
      ok: false,
      reason: 'officer-not-found',
    })
    expect(store.getState().game).toBe(snapshot)
  })

  it('dismiss 仅移除该项、clearFeedback 清空', () => {
    const store = fixtureStore()
    store.getState().dispatch({ type: 'reclaim', officerId: 1 })
    store.getState().dispatch({ type: 'commerce', officerId: 2 })
    const [first] = store.getState().feedback
    store.getState().dismiss(first!.id)
    expect(store.getState().feedback.some((f) => f.id === first!.id)).toBe(false)
    store.getState().clearFeedback()
    expect(store.getState().feedback).toEqual([])
  })

  it('feedback id 唯一且单调递增', () => {
    const store = fixtureStore()
    store.getState().dispatch({ type: 'reclaim', officerId: 1 })
    store.getState().dispatch({ type: 'commerce', officerId: 2 })
    const ids = store.getState().feedback.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids]).toEqual([...ids].sort((a, b) => a - b))
  })

  it('newGame 创建正式剧本、替换 game 并清空 feedback', () => {
    const store = fixtureStore()
    store.getState().dispatch({ type: 'reclaim', officerId: 1 })
    store.getState().newGame({ scenarioId: 'period-1', playerLordId: 1, seed: 2 })
    expect(store.getState().game?.year).toBe(190)
    expect(store.getState().game?.playerLordId).toBe(1)
    expect(Object.keys(store.getState().game!.cities)).toHaveLength(38)
    expect(store.getState().feedback).toEqual([])
  })
})

import { describe, it, expect } from 'vitest'
import { createGameStore } from './game-store'
import type { OutcomeEvent } from '../core/shared/outcome'

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
  it('初始即 fixture 局面、feedback 为空', () => {
    const store = createGameStore(1)
    const { game, feedback } = store.getState()
    expect(game.year).toBe(189)
    expect(game.month).toBe(1)
    expect(game.playerLordId).toBe('liubei')
    expect(feedback).toEqual([])
  })

  it('dispatch 即时指令成功：更新 game + 入队 develop-done 事件 + 返回 ok', () => {
    const store = createGameStore(1)
    const before = store.getState().game.cities.chengdu!.agriculture
    const result = store.getState().dispatch({ type: 'reclaim', officerId: 'liubei' })
    expect(result.ok).toBe(true)
    expect(store.getState().game.cities.chengdu!.agriculture).toBeGreaterThan(before)
    const ev = findEvent(store, 'develop-done')
    expect(ev?.kind).toBe('develop-done')
  })

  it('dispatch 失败：game 不变 + 入队 failure(reason) + 返回 ok:false', () => {
    const store = createGameStore(1)
    const snapshot = store.getState().game
    const result = store.getState().dispatch({ type: 'reclaim', officerId: 'nobody' })
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
    const store = createGameStore(1)
    store.getState().dispatch({ type: 'reclaim', officerId: 'liubei' })
    const issued = store.getState().feedback.find((f) => f.payload.kind === 'issued')
    expect(issued).toBeDefined()
    if (issued?.payload.kind === 'issued') {
      expect(issued.payload.action).toEqual({ type: 'reclaim', officerId: 'liubei' })
    }
  })

  it('dispatch 失败不入队 issued（只入 failure）', () => {
    const store = createGameStore(1)
    store.getState().dispatch({ type: 'reclaim', officerId: 'nobody' })
    expect(store.getState().feedback.some((f) => f.payload.kind === 'issued')).toBe(false)
  })

  it('endMonth 推进月份；先掠夺再 endMonth → 队列含 plunder-done', () => {
    const store = createGameStore(1)
    store.getState().dispatch({ type: 'plunder', officerId: 'liubei' })
    store.getState().dispatch({ type: 'endMonth' })
    expect(store.getState().game.month).toBe(2)
    expect(findEvent(store, 'plunder-done')?.kind).toBe('plunder-done')
  })

  it('canDispatch 返回 canApply 结果且不改状态', () => {
    const store = createGameStore(1)
    const snapshot = store.getState().game
    expect(store.getState().canDispatch({ type: 'reclaim', officerId: 'liubei' }).ok).toBe(true)
    expect(store.getState().canDispatch({ type: 'reclaim', officerId: 'nobody' })).toEqual({
      ok: false,
      reason: 'officer-not-found',
    })
    expect(store.getState().game).toBe(snapshot)
  })

  it('dismiss 仅移除该项、clearFeedback 清空', () => {
    const store = createGameStore(1)
    store.getState().dispatch({ type: 'reclaim', officerId: 'liubei' })
    store.getState().dispatch({ type: 'commerce', officerId: 'zhugeliang' })
    const [first] = store.getState().feedback
    store.getState().dismiss(first!.id)
    expect(store.getState().feedback.some((f) => f.id === first!.id)).toBe(false)
    store.getState().clearFeedback()
    expect(store.getState().feedback).toEqual([])
  })

  it('feedback id 唯一且单调递增', () => {
    const store = createGameStore(1)
    store.getState().dispatch({ type: 'reclaim', officerId: 'liubei' })
    store.getState().dispatch({ type: 'commerce', officerId: 'zhugeliang' })
    const ids = store.getState().feedback.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids]).toEqual([...ids].sort((a, b) => a - b))
  })

  it('newGame 替换 game、清空 feedback', () => {
    const store = createGameStore(1)
    store.getState().dispatch({ type: 'reclaim', officerId: 'liubei' })
    const moved = store.getState().game.cities.chengdu!.agriculture
    store.getState().newGame(2)
    expect(store.getState().game.cities.chengdu!.agriculture).not.toBe(moved)
    expect(store.getState().feedback).toEqual([])
  })
})

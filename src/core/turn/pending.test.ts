import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import { DEFAULT_CONFIG } from '../shared/config'
import { plunder } from '../economy/plunder'
import { campaign } from '../economy/campaign'
import type { GameState } from '../game-state'
import { runNonCampaignPending } from './pending'

const cfg = DEFAULT_CONFIG

function withOfficer(
  s: GameState,
  id: number,
  patch: Partial<GameState['officers'][number]>
): GameState {
  return { ...s, officers: { ...s.officers, [id]: { ...s.officers[id]!, ...patch } } }
}

describe('runNonCampaignPending 月末非 campaign 分派', () => {
  it('执行掠夺并清空队列', () => {
    const queued = plunder(createInitialState(1), 2, cfg).state
    const next = runNonCampaignPending(queued, cfg).state
    expect(next.cities[1]!.agriculture).toBe(150)
    expect(next.cities[1]!.food).toBe(400 + 750)
    expect(next.cities[1]!.gold).toBe(500 + 300)
    expect(next.pendingCommands).toEqual([])
  })

  it('空队列原样返回', () => {
    const s = createInitialState(1)
    expect(runNonCampaignPending(s, cfg).state).toBe(s)
  })

  it('同城多条连续减半、收益累加', () => {
    // 诸葛亮 power=150、庞统 power=140（智90+武50）
    let s = plunder(createInitialState(1), 2, cfg).state
    s = plunder(s, 3, cfg).state
    const next = runNonCampaignPending(s, cfg).state
    expect(next.cities[1]!.agriculture).toBe(75) // 300->150->75
    expect(next.cities[1]!.commerce).toBe(50) // 200->100->50
    expect(next.cities[1]!.loyalty).toBe(12) // 50->25->12
    expect(next.cities[1]!.food).toBe(400 + 750 + 700)
    expect(next.cities[1]!.gold).toBe(500 + 300 + 280)
  })

  it('结果与下令顺序无关', () => {
    const base = createInitialState(1)
    const ab = runNonCampaignPending(plunder(plunder(base, 2, cfg).state, 3, cfg).state, cfg).state
    const ba = runNonCampaignPending(plunder(plunder(base, 3, cfg).state, 2, cfg).state, cfg).state
    expect(ab.cities[1]).toEqual(ba.cities[1])
  })

  it('混合队列：执行掠夺、保留 campaign（出征交由 end-month 结算）', () => {
    let s = withOfficer(createInitialState(1), 4, { troops: 500 })
    s = campaign(s, [4, 5], 3, 120).state
    s = plunder(s, 2, cfg).state
    const next = runNonCampaignPending(s, cfg).state
    expect(next.cities[1]!.agriculture).toBe(150) // 掠夺生效
    expect(next.cities[3]!.lordId).toBe(6) // 出征未在此结算
    expect(next.pendingCommands).toHaveLength(1)
    expect(next.pendingCommands[0]!.type).toBe('campaign')
  })
})

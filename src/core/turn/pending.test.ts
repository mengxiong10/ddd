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
  id: string,
  patch: Partial<GameState['officers'][string]>
): GameState {
  return { ...s, officers: { ...s.officers, [id]: { ...s.officers[id]!, ...patch } } }
}

describe('runNonCampaignPending 月末非 campaign 分派', () => {
  it('执行掠夺并清空队列', () => {
    const queued = plunder(createInitialState(1), 'zhugeliang', cfg).state
    const next = runNonCampaignPending(queued, cfg).state
    expect(next.cities.chengdu!.agriculture).toBe(150)
    expect(next.cities.chengdu!.food).toBe(400 + 750)
    expect(next.cities.chengdu!.gold).toBe(500 + 300)
    expect(next.pendingCommands).toEqual([])
  })

  it('空队列原样返回', () => {
    const s = createInitialState(1)
    expect(runNonCampaignPending(s, cfg).state).toBe(s)
  })

  it('同城多条连续减半、收益累加', () => {
    // 诸葛亮 power=150、庞统 power=140（智90+武50）
    let s = plunder(createInitialState(1), 'zhugeliang', cfg).state
    s = plunder(s, 'pangtong', cfg).state
    const next = runNonCampaignPending(s, cfg).state
    expect(next.cities.chengdu!.agriculture).toBe(75) // 300->150->75
    expect(next.cities.chengdu!.commerce).toBe(50) // 200->100->50
    expect(next.cities.chengdu!.loyalty).toBe(12) // 50->25->12
    expect(next.cities.chengdu!.food).toBe(400 + 750 + 700)
    expect(next.cities.chengdu!.gold).toBe(500 + 300 + 280)
  })

  it('结果与下令顺序无关', () => {
    const base = createInitialState(1)
    const ab = runNonCampaignPending(
      plunder(plunder(base, 'zhugeliang', cfg).state, 'pangtong', cfg).state,
      cfg
    ).state
    const ba = runNonCampaignPending(
      plunder(plunder(base, 'pangtong', cfg).state, 'zhugeliang', cfg).state,
      cfg
    ).state
    expect(ab.cities.chengdu).toEqual(ba.cities.chengdu)
  })

  it('混合队列：执行掠夺、保留 campaign（出征交由 end-month 结算）', () => {
    let s = withOfficer(createInitialState(1), 'guanyu', { troops: 500 })
    s = campaign(s, ['guanyu', 'zhangfei'], 'xuchang', 120).state
    s = plunder(s, 'zhugeliang', cfg).state
    const next = runNonCampaignPending(s, cfg).state
    expect(next.cities.chengdu!.agriculture).toBe(150) // 掠夺生效
    expect(next.cities.xuchang!.lordId).toBe('caocao') // 出征未在此结算
    expect(next.pendingCommands).toHaveLength(1)
    expect(next.pendingCommands[0]!.type).toBe('campaign')
  })
})

import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import type { GameState } from '../game-state'
import { canCampaign, campaign } from './campaign'
import { isBusy } from '../world/queries'

// 出征场景：江陵（刘备：关羽、张飞）相邻许昌（曹操）。江陵粮 300。
const ATTACKERS = ['guanyu', 'zhangfei']
const TARGET = 'xuchang'

/** 占用某武将（占用为派生：入队一条引用该武将的命令）。 */
function occupy(s: GameState, id: string): GameState {
  return { ...s, pendingCommands: [...s.pendingCommands, { type: 'develop', officerId: id }] }
}

function withCity(
  s: GameState,
  id: string,
  patch: Partial<GameState['cities'][string]>
): GameState {
  return { ...s, cities: { ...s.cities, [id]: { ...s.cities[id]!, ...patch } } }
}

describe('canCampaign 前置校验', () => {
  it('满足条件时通过', () => {
    expect(canCampaign(createInitialState(1), ATTACKERS, TARGET, 100).ok).toBe(true)
  })

  it('武将数 0 -> 拒绝', () => {
    expect(canCampaign(createInitialState(1), [], TARGET, 100).ok).toBe(false)
  })

  it('武将数 >10 -> 拒绝', () => {
    const ids = Array.from({ length: 11 }, (_, i) => `o${i}`)
    expect(canCampaign(createInitialState(1), ids, TARGET, 100).ok).toBe(false)
  })

  it('武将重复 -> 拒绝', () => {
    expect(canCampaign(createInitialState(1), ['guanyu', 'guanyu'], TARGET, 100).ok).toBe(false)
  })

  it('武将不在同一城 -> 拒绝（关羽江陵 + 刘备成都）', () => {
    expect(canCampaign(createInitialState(1), ['guanyu', 'liubei'], TARGET, 100).ok).toBe(false)
  })

  it('武将已占用 -> 拒绝', () => {
    const s = occupy(createInitialState(1), 'guanyu')
    expect(canCampaign(s, ATTACKERS, TARGET, 100).ok).toBe(false)
  })

  it('随军粮草 < 1 -> 拒绝', () => {
    expect(canCampaign(createInitialState(1), ATTACKERS, TARGET, 0).ok).toBe(false)
  })

  it('随军粮草 > 城粮 -> 拒绝', () => {
    expect(canCampaign(createInitialState(1), ATTACKERS, TARGET, 301).ok).toBe(false)
  })

  it('随军粮草非整数 -> 拒绝', () => {
    expect(canCampaign(createInitialState(1), ATTACKERS, TARGET, 1.5).ok).toBe(false)
  })

  it('城粮为 0 -> 拒绝', () => {
    const s = withCity(createInitialState(1), 'jiangling', { food: 0 })
    expect(canCampaign(s, ATTACKERS, TARGET, 1).ok).toBe(false)
  })

  it('目标城是己方城 -> 拒绝（江陵打成都，皆刘备）', () => {
    expect(canCampaign(createInitialState(1), ATTACKERS, 'chengdu', 100).ok).toBe(false)
  })

  it('目标城是本城 -> 拒绝', () => {
    expect(canCampaign(createInitialState(1), ATTACKERS, 'jiangling', 100).ok).toBe(false)
  })

  it('目标城不存在 -> 拒绝', () => {
    expect(canCampaign(createInitialState(1), ATTACKERS, 'nowhere', 100).ok).toBe(false)
  })

  it('目标城不相邻 -> 拒绝（江陵打邺城）', () => {
    expect(canCampaign(createInitialState(1), ATTACKERS, 'ye', 100).ok).toBe(false)
  })
})

describe('campaign 下令（效果延后）', () => {
  it('扣本城粮、武将占用(入队 campaign)；目标城/RNG 不变', () => {
    const s = createInitialState(1)
    const next = campaign(s, ATTACKERS, TARGET, 120).state
    expect(next.cities.jiangling!.food).toBe(300 - 120)
    expect(isBusy(next, 'guanyu')).toBe(true)
    expect(isBusy(next, 'zhangfei')).toBe(true)
    expect(next.pendingCommands).toEqual([
      { type: 'campaign', officerIds: ATTACKERS, targetCityId: TARGET, provisions: 120 },
    ])
    // 目标城与出征武将所在城均未在下令时变更
    expect(next.cities.xuchang!.lordId).toBe('caocao')
    expect(next.officers.guanyu!.cityId).toBe('jiangling')
    expect(next.rng.seed).toBe(s.rng.seed)
  })

  it('非法下令 no-op（state 不变、自报告失败 reason）', () => {
    const s = createInitialState(1)
    const res = campaign(s, ATTACKERS, 'ye', 100)
    expect(res.state).toBe(s)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('target-not-adjacent')
  })
})

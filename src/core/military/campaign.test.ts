import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import type { GameState } from '../game-state'
import { isCaptive } from '../world/queries'
import { executeCampaign } from './campaign'

// 江陵(刘备:关羽、张飞) 相邻 许昌(曹操:曹操、荀彧、郭嘉)。默认所有武将兵=100、后备兵=0。
const ATTACKERS = ['guanyu', 'zhangfei']
const TARGET = 'xuchang'

function withOfficer(s: GameState, id: string, patch: Partial<GameState['officers'][string]>): GameState {
  return { ...s, officers: { ...s.officers, [id]: { ...s.officers[id]!, ...patch } } }
}
function withCity(s: GameState, id: string, patch: Partial<GameState['cities'][string]>): GameState {
  return { ...s, cities: { ...s.cities, [id]: { ...s.cities[id]!, ...patch } } }
}

describe('executeCampaign 攻方胜（攻 > 守）', () => {
  // 关羽 500 + 张飞 100 = 600 > 守方 300
  const s = withOfficer(createInitialState(1), 'guanyu', { troops: 500 })
  const next = executeCampaign(s, ATTACKERS, TARGET, 120)

  it('目标城归攻方、城粮 += 随军粮草、后备兵随城易主', () => {
    expect(next.cities.xuchang!.lordId).toBe('liubei')
    expect(next.cities.xuchang!.food).toBe(500 + 120)
  })

  it('出征武将进驻被占城、且非俘虏', () => {
    expect(next.officers.guanyu!.cityId).toBe('xuchang')
    expect(next.officers.zhangfei!.cityId).toBe('xuchang')
    expect(isCaptive(next, 'guanyu')).toBe(false)
  })

  it('原守军就地成俘虏', () => {
    expect(isCaptive(next, 'xunyu')).toBe(true)
    expect(next.officers.xunyu!.cityId).toBe('xuchang')
  })

  it('被俘君主曹操触发重选（邺城归智力最高的司马懿）', () => {
    expect(isCaptive(next, 'caocao')).toBe(true)
    expect(next.cities.ye!.lordId).toBe('simayi')
    expect(next.officers.simayi!.lordId).toBe('simayi')
  })
})

describe('executeCampaign 攻方败（攻 ≤ 守）', () => {
  it('目标城不变；出征武将进城并成俘虏；城粮不加', () => {
    const next = executeCampaign(createInitialState(1), ATTACKERS, TARGET, 120) // 200 < 300
    expect(next.cities.xuchang!.lordId).toBe('caocao')
    expect(next.cities.xuchang!.food).toBe(500)
    expect(next.officers.guanyu!.cityId).toBe('xuchang')
    expect(isCaptive(next, 'guanyu')).toBe(true)
    expect(isCaptive(next, 'zhangfei')).toBe(true)
  })

  it('平局判守方胜（攻=守）', () => {
    // 关羽 200 + 张飞 100 = 300 == 守方 300
    const s = withOfficer(createInitialState(1), 'guanyu', { troops: 200 })
    const next = executeCampaign(s, ATTACKERS, TARGET, 50)
    expect(next.cities.xuchang!.lordId).toBe('caocao')
    expect(isCaptive(next, 'guanyu')).toBe(true)
  })
})

describe('executeCampaign 守方兵力口径', () => {
  it('排除城内已有俘虏', () => {
    // 郭嘉变成许昌内的俘虏(lordId=liubei) -> 守方只计曹操100+荀彧100=200
    // 攻方 关羽150+张飞100=250 > 200 -> 攻方胜（若误计郭嘉则 300，攻方应败）
    let s = withOfficer(createInitialState(1), 'guojia', { lordId: 'liubei' })
    s = withOfficer(s, 'guanyu', { troops: 150 })
    const next = executeCampaign(s, ATTACKERS, TARGET, 10)
    expect(next.cities.xuchang!.lordId).toBe('liubei')
  })

  it('计入城后备兵', () => {
    // 守方 300 + 后备兵 200 = 500；攻方 关羽350+张飞100=450 < 500 -> 攻方败
    let s = withCity(createInitialState(1), 'xuchang', { reserveTroops: 200 })
    s = withOfficer(s, 'guanyu', { troops: 350 })
    const next = executeCampaign(s, ATTACKERS, TARGET, 10)
    expect(next.cities.xuchang!.lordId).toBe('caocao')
  })
})

describe('executeCampaign 攻方君主随军战败被俘 -> 其势力重选', () => {
  it('曹操出征江陵战败 -> 曹操成俘虏，曹操势力立郭嘉(智98)为君主', () => {
    // 曹操(许昌)出征江陵(刘备:关羽100+张飞100=200)，曹操兵100 < 200 -> 败
    const next = executeCampaign(createInitialState(1), ['caocao'], 'jiangling', 30)
    expect(next.officers.caocao!.cityId).toBe('jiangling')
    expect(isCaptive(next, 'caocao')).toBe(true)
    expect(next.cities.xuchang!.lordId).toBe('guojia')
    expect(next.cities.ye!.lordId).toBe('guojia')
    expect(next.officers.guojia!.lordId).toBe('guojia')
  })
})

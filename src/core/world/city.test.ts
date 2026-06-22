import { describe, it, expect } from 'vitest'
import type { City } from './city'
import {
  attributeCap,
  raiseAttribute,
  spendGold,
  addFood,
  addGold,
  addReserveTroops,
  ravage,
  gainLoyalty,
  addPopulation,
  setStatus,
  raisePrevention,
  applyDisasterDamage,
  applyBattleDamage,
} from './city'

const base: City = {
  id: 1,
  name: '成都',
  lordId: 1,
  agriculture: 300,
  commerce: 200,
  agricultureCap: 1000,
  commerceCap: 1000,
  gold: 500,
  food: 400,
  loyalty: 50,
  reserveTroops: 0,
  population: 30000,
  status: 'normal',
  disasterPrevention: 50,
  battleMapId: 'plains',
}

describe('city 聚合', () => {
  it('attributeCap 按 kind 取上限', () => {
    expect(attributeCap({ ...base, agricultureCap: 800 }, 'agriculture')).toBe(800)
    expect(attributeCap({ ...base, commerceCap: 600 }, 'commerce')).toBe(600)
  })

  it('raiseAttribute 增长农业', () => {
    expect(raiseAttribute(base, 'agriculture', 30).agriculture).toBe(330)
  })

  it('raiseAttribute 按城级上限截断', () => {
    expect(raiseAttribute({ ...base, agriculture: 990 }, 'agriculture', 30).agriculture).toBe(1000)
  })

  it('raiseAttribute 增长商业', () => {
    expect(raiseAttribute(base, 'commerce', 30).commerce).toBe(230)
  })

  it('spendGold 扣金', () => {
    expect(spendGold(base, 50).gold).toBe(450)
  })

  it('addFood / addGold 增加资源', () => {
    expect(addFood(base, 75).food).toBe(475)
    expect(addGold(base, 100).gold).toBe(600)
  })

  it('addReserveTroops 增减后备兵，不低于 0', () => {
    expect(addReserveTroops(base, 50).reserveTroops).toBe(50)
    expect(addReserveTroops({ ...base, reserveTroops: 30 }, -50).reserveTroops).toBe(0)
  })

  it('ravage 农业/商业/民忠各 floor(÷2)，不碰粮/金', () => {
    const r = ravage({ ...base, agriculture: 301, commerce: 200, loyalty: 51 })
    expect(r.agriculture).toBe(150)
    expect(r.commerce).toBe(100)
    expect(r.loyalty).toBe(25)
    expect(r.food).toBe(base.food)
    expect(r.gold).toBe(base.gold)
  })

  it('ravage 连续两次再减半（基于上次结果）', () => {
    expect(ravage(ravage(base)).agriculture).toBe(75)
  })

  it('gainLoyalty 回升民忠，封顶 100、不碰其它字段', () => {
    expect(gainLoyalty(base, 4).loyalty).toBe(54)
    expect(gainLoyalty({ ...base, loyalty: 98 }, 4).loyalty).toBe(100)
    expect(gainLoyalty(base, 4).food).toBe(base.food)
  })

  it('addPopulation 累加人口', () => {
    expect(addPopulation(base, 100).population).toBe(30100)
  })

  it('setStatus 改状态、不碰其它字段', () => {
    const r = setStatus(base, 'famine')
    expect(r.status).toBe('famine')
    expect(r.disasterPrevention).toBe(base.disasterPrevention)
    expect(r.gold).toBe(base.gold)
  })

  it('raisePrevention 回升防灾、封顶 100、下限 0、不碰其它字段', () => {
    expect(raisePrevention(base, 4).disasterPrevention).toBe(54)
    expect(raisePrevention({ ...base, disasterPrevention: 98 }, 4).disasterPrevention).toBe(100)
    expect(raisePrevention({ ...base, disasterPrevention: 2 }, -5).disasterPrevention).toBe(0)
    expect(raisePrevention(base, 4).status).toBe(base.status)
  })

  it('applyDisasterDamage normal 原样返回', () => {
    expect(applyDisasterDamage(base, 'normal')).toBe(base)
  })

  it('applyDisasterDamage 饥荒：商业-5% 民忠-5% 后备兵减半 人口-25% 农业-5%，不碰粮/金', () => {
    const c = {
      ...base,
      commerce: 201,
      loyalty: 51,
      reserveTroops: 101,
      population: 30001,
      agriculture: 301,
    }
    const r = applyDisasterDamage(c, 'famine')
    expect(r.commerce).toBe(Math.floor(201 * 0.95))
    expect(r.loyalty).toBe(Math.floor(51 * 0.95))
    expect(r.reserveTroops).toBe(50)
    expect(r.population).toBe(Math.floor(30001 * 0.75))
    expect(r.agriculture).toBe(Math.floor(301 * 0.95))
    expect(r.food).toBe(c.food)
    expect(r.gold).toBe(c.gold)
  })

  it('applyDisasterDamage 旱灾：粮-5% 后备兵-25% 人口-25% 农业-5%，不碰商业/金/民忠', () => {
    const c = { ...base, food: 401, reserveTroops: 101, population: 30001, agriculture: 301 }
    const r = applyDisasterDamage(c, 'drought')
    expect(r.food).toBe(Math.floor(401 * 0.95))
    expect(r.reserveTroops).toBe(Math.floor(101 * 0.75))
    expect(r.population).toBe(Math.floor(30001 * 0.75))
    expect(r.agriculture).toBe(Math.floor(301 * 0.95))
    expect(r.commerce).toBe(c.commerce)
    expect(r.gold).toBe(c.gold)
    expect(r.loyalty).toBe(c.loyalty)
  })

  it('applyDisasterDamage 水灾：粮-5% 商业-10% 金-10% 后备兵-25% 人口-25% 农业-5%，不碰民忠', () => {
    const c = {
      ...base,
      food: 401,
      commerce: 201,
      gold: 501,
      reserveTroops: 101,
      population: 30001,
      agriculture: 301,
    }
    const r = applyDisasterDamage(c, 'flood')
    expect(r.food).toBe(Math.floor(401 * 0.95))
    expect(r.commerce).toBe(Math.floor(201 * 0.9))
    expect(r.gold).toBe(Math.floor(501 * 0.9))
    expect(r.reserveTroops).toBe(Math.floor(101 * 0.75))
    expect(r.population).toBe(Math.floor(30001 * 0.75))
    expect(r.agriculture).toBe(Math.floor(301 * 0.95))
    expect(r.loyalty).toBe(c.loyalty)
  })

  it('applyDisasterDamage 暴动：粮-5% 商业-5% 金-5% 民忠-10% 后备兵减半 农业-5%，不碰人口', () => {
    const c = {
      ...base,
      food: 401,
      commerce: 201,
      gold: 501,
      loyalty: 51,
      reserveTroops: 101,
      agriculture: 301,
    }
    const r = applyDisasterDamage(c, 'riot')
    expect(r.food).toBe(Math.floor(401 * 0.95))
    expect(r.commerce).toBe(Math.floor(201 * 0.95))
    expect(r.gold).toBe(Math.floor(501 * 0.95))
    expect(r.loyalty).toBe(Math.floor(51 * 0.9))
    expect(r.reserveTroops).toBe(50)
    expect(r.agriculture).toBe(Math.floor(301 * 0.95))
    expect(r.population).toBe(c.population)
  })

  it('applyBattleDamage 战损：农/商/金 -5%、民忠 -10%，不碰粮/后备兵/人口', () => {
    const c = {
      ...base,
      agriculture: 301,
      commerce: 201,
      gold: 501,
      loyalty: 51,
      food: 401,
      reserveTroops: 101,
      population: 30001,
    }
    const r = applyBattleDamage(c)
    expect(r.agriculture).toBe(Math.floor(301 * 0.95))
    expect(r.commerce).toBe(Math.floor(201 * 0.95))
    expect(r.gold).toBe(Math.floor(501 * 0.95))
    expect(r.loyalty).toBe(Math.floor(51 * 0.9))
    expect(r.food).toBe(c.food)
    expect(r.reserveTroops).toBe(c.reserveTroops)
    expect(r.population).toBe(c.population)
  })
})

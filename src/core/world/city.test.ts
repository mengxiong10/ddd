import { describe, it, expect } from 'vitest'
import type { City } from './city'
import { attributeCap, raiseAttribute, spendGold, addFood, addGold, addReserveTroops, ravage } from './city'

const base: City = {
  id: 'c1', name: '成都', lordId: 'o1',
  agriculture: 300, commerce: 200, agricultureCap: 1000, commerceCap: 1000,
  gold: 500, food: 400, loyalty: 50, reserveTroops: 0,
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
})

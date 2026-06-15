import { describe, it, expect } from 'vitest'
import type { Officer } from './officer'
import { spendStamina, recoverStamina, setBusy } from './officer'

const base: Officer = {
  id: 'o1', name: '测试', intelligence: 50, lordId: 'o1', cityId: 'c1', stamina: 100, busy: false,
}

describe('officer 聚合', () => {
  it('spendStamina 扣减体力', () => {
    expect(spendStamina(base, 8).stamina).toBe(92)
  })

  it('spendStamina 不低于 0', () => {
    expect(spendStamina({ ...base, stamina: 5 }, 8).stamina).toBe(0)
  })

  it('recoverStamina 增加但封顶', () => {
    expect(recoverStamina({ ...base, stamina: 98 }, 4, 100).stamina).toBe(100)
    expect(recoverStamina({ ...base, stamina: 90 }, 4, 100).stamina).toBe(94)
  })

  it('setBusy 切换占用', () => {
    expect(setBusy(base, true).busy).toBe(true)
    expect(setBusy({ ...base, busy: true }, false).busy).toBe(false)
  })
})

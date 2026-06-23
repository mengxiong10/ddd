import { describe, it, expect } from 'vitest'
import { selectUnit, setMove, toAttack, toCast, actToBattleAction, restAction } from './act-draft'

describe('act-draft', () => {
  it('选单位→设落点→休息成型', () => {
    const d = setMove(selectUnit(5), { x: 3, y: 4 })
    expect(restAction(d)).toEqual({
      type: 'act',
      officerId: 5,
      moveTo: { x: 3, y: 4 },
      terminal: { kind: 'rest' },
    })
  })

  it('attack 需目标方成型，无目标返回 null', () => {
    const d = toAttack(selectUnit(2))
    expect(actToBattleAction(d)).toBeNull()
    expect(actToBattleAction(d, { x: 1, y: 1 })).toEqual({
      type: 'act',
      officerId: 2,
      terminal: { kind: 'attack', target: { x: 1, y: 1 } },
    })
  })

  it('cast 自带目标则带、无则省（self 技能）', () => {
    const d = toCast(selectUnit(9), 3)
    expect(actToBattleAction(d)).toEqual({
      type: 'act',
      officerId: 9,
      terminal: { kind: 'cast', skillId: 3 },
    })
    expect(actToBattleAction(d, { x: 2, y: 2 })).toEqual({
      type: 'act',
      officerId: 9,
      terminal: { kind: 'cast', skillId: 3, target: { x: 2, y: 2 } },
    })
  })
})

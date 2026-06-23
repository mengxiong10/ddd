import { describe, it, expect } from 'vitest'
import { startCommand, advanceDraft, draftToAction, isAwaitingTargetCity } from './command-draft'

describe('command-draft', () => {
  it('执行人-only 命令选将即集齐成 Action', () => {
    const d = advanceDraft(startCommand('reclaim'), { slot: 'executor', officerId: 7 })
    expect(draftToAction(d)).toEqual({ type: 'reclaim', officerId: 7 })
  })

  it('scout/move 在收集执行人后处于等目标城态', () => {
    const d = advanceDraft(startCommand('scout'), { slot: 'executor', officerId: 3 })
    expect(isAwaitingTargetCity(d)).toBe(true)
    expect(draftToAction(d)).toBeNull()
    const done = advanceDraft(d, { slot: 'target-city', targetCityId: 12 })
    expect(draftToAction(done)).toEqual({ type: 'scout', officerId: 3, targetCityId: 12 })
  })

  it('campaign 收集名单+目标城+粮草后成 Action', () => {
    let d = advanceDraft(startCommand('campaign'), {
      slot: 'campaign-members',
      officerIds: [1, 2],
    })
    expect(draftToAction(d)).toBeNull()
    d = advanceDraft(d, { slot: 'target-city', targetCityId: 9 })
    expect(draftToAction(d)).toBeNull()
    d = advanceDraft(d, { slot: 'provisions', provisions: 500 })
    expect(draftToAction(d)).toEqual({
      type: 'campaign',
      officerIds: [1, 2],
      targetCityId: 9,
      provisions: 500,
    })
  })

  it('recruit 数量终结槽集齐成 Action', () => {
    const d = advanceDraft(
      advanceDraft(startCommand('recruit'), { slot: 'executor', officerId: 5 }),
      { slot: 'amount', amount: 200 }
    )
    expect(draftToAction(d)).toEqual({ type: 'recruit', officerId: 5, amount: 200 })
  })
})

import type { GameState } from '../game-state'
import type { ItemId, OfficerId } from '../shared/ids'
import type { CommandCheck } from '../shared/command'
import { commandOk, commandFail, type WithCheck } from '../shared/outcome'
import { MAX_ITEMS_PER_OFFICER, holdByCity, holdByOfficer } from '../world/item'
import { adjustLoyalty } from '../world/officer'
import { isCaptive, itemsOfOfficer } from '../world/queries'

/**
 * 赏赐/没收的忠诚增减幅度（规则身份，内联常量，不入 config）。
 * 君主忠诚派生恒 100，故只对非君主写入。
 */
const REWARD_LOYALTY_GAIN = 8
const CONFISCATE_LOYALTY_LOSS = 20

/** 武将是否为君主（君主忠诚不写存储值）。 */
function isLord(state: GameState, officerId: OfficerId): boolean {
  const o = state.officers[officerId]!
  return o.lordId === o.id
}

/** 该武将下一个装备序号 = 1 + 现有所持道具最大 equipSeq（无则 -1 ⇒ 首件为 0）；表达装备先后。 */
function nextEquipSeq(state: GameState, officerId: OfficerId): number {
  const max = itemsOfOfficer(state, officerId).reduce(
    (m, i) => (i.holder.kind === 'officer' ? Math.max(m, i.holder.equipSeq) : m),
    -1
  )
  return max + 1
}

/**
 * 校验赏赐前置（不改状态）：作用城 = 武将所在城。
 * 武将存在且非俘虏；道具存在且 holder 为作用城；该武将道具数 < 上限。
 * 不校验 busy——君主对武将下令，武将本月仍可被其他指令占用。
 */
export function canReward(state: GameState, officerId: OfficerId, itemId: ItemId): CommandCheck {
  const officer = state.officers[officerId]
  if (!officer) return { ok: false, reason: 'officer-not-found' }
  if (isCaptive(state, officerId)) return { ok: false, reason: 'is-captive' }
  const item = state.items[itemId]
  if (!item) return { ok: false, reason: 'item-not-found' }
  if (!(item.holder.kind === 'city' && item.holder.cityId === officer.cityId)) {
    return { ok: false, reason: 'item-not-in-city' }
  }
  if (!item.discovered) return { ok: false, reason: 'item-undiscovered' }
  if (itemsOfOfficer(state, officerId).length >= MAX_ITEMS_PER_OFFICER) {
    return { ok: false, reason: 'officer-items-full' }
  }
  return { ok: true }
}

/**
 * 赏赐：把作用城的道具转给该城非俘虏武将。即时、不占人、不耗 RNG。
 * 道具 holder→该武将；非君主忠诚 +8（封顶）。非法 no-op。
 */
export function reward(
  state: GameState,
  officerId: OfficerId,
  itemId: ItemId
): WithCheck<GameState> {
  const check = canReward(state, officerId, itemId)
  if (!check.ok) return commandFail(check, state)

  const items = {
    ...state.items,
    [itemId]: holdByOfficer(state.items[itemId]!, officerId, nextEquipSeq(state, officerId)),
  }
  if (isLord(state, officerId)) return commandOk({ ...state, items })

  const officer = adjustLoyalty(state.officers[officerId]!, REWARD_LOYALTY_GAIN)
  return commandOk({ ...state, items, officers: { ...state.officers, [officerId]: officer } })
}

/**
 * 校验没收前置（不改状态）：武将存在且非俘虏；道具存在且 holder 为该武将。
 */
export function canConfiscate(
  state: GameState,
  officerId: OfficerId,
  itemId: ItemId
): CommandCheck {
  const officer = state.officers[officerId]
  if (!officer) return { ok: false, reason: 'officer-not-found' }
  if (isCaptive(state, officerId)) return { ok: false, reason: 'is-captive' }
  const item = state.items[itemId]
  if (!item) return { ok: false, reason: 'item-not-found' }
  if (!(item.holder.kind === 'officer' && item.holder.officerId === officerId)) {
    return { ok: false, reason: 'item-not-held-by-officer' }
  }
  return { ok: true }
}

/**
 * 没收：把武将所持道具收回其所在城。即时、不占人、不耗 RNG。
 * 道具 holder→officer.cityId；非君主忠诚 −20（下限 0）。非法 no-op。
 */
export function confiscate(
  state: GameState,
  officerId: OfficerId,
  itemId: ItemId
): WithCheck<GameState> {
  const check = canConfiscate(state, officerId, itemId)
  if (!check.ok) return commandFail(check, state)

  const officer0 = state.officers[officerId]!
  const items = { ...state.items, [itemId]: holdByCity(state.items[itemId]!, officer0.cityId) }
  if (isLord(state, officerId)) return commandOk({ ...state, items })

  const officer = adjustLoyalty(officer0, -CONFISCATE_LOYALTY_LOSS)
  return commandOk({ ...state, items, officers: { ...state.officers, [officerId]: officer } })
}

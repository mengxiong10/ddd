import type { GameState } from '../game-state'
import type { CityId, OfficerId } from '../shared/ids'
import type { City } from './city'
import type { Officer } from './officer'
import { LOYALTY_MAX } from './officer'
import type { Item } from './item'
import type { TroopType } from './troop-type'
import { BASE_MOVEMENT, resolveOverride } from './troop-type'

/**
 * 俘虏判定（派生，非存储字段）：武将自身归属 ≠ 所在城归属即为俘虏。
 * 占领只改 city.lordId，原守军 lordId 不动，自动在此意义上成俘虏。
 * 无主武将（lordId===null，未登场/在野）不是俘虏——它本就不归属任何势力。
 */
export function isCaptive(state: GameState, officerId: OfficerId): boolean {
  const officer = state.officers[officerId]
  if (!officer) return false
  if (officer.lordId === null) return false
  const city = state.cities[officer.cityId]
  if (!city) return false
  return officer.lordId !== city.lordId
}

/**
 * 取驻于某城的武将。onlyAvailable=true 时仅返回「在任」武将（未被占用、非俘虏、非无主/在野），
 * 即可被下令的武将；UI 据此列出可指派对象。在野武将（lordId===null）隐匿、不可被指派。
 */
export function officersInCity(
  state: GameState,
  cityId: CityId,
  opts?: { onlyAvailable?: boolean }
): Officer[] {
  const onlyAvailable = opts?.onlyAvailable ?? false
  return Object.values(state.officers).filter(
    (o) =>
      o.cityId === cityId &&
      (!onlyAvailable || (!o.busy && o.lordId !== null && !isCaptive(state, o.id)))
  )
}

/** 本城在野武将（lordId===null）：搜寻招募的候选。隐匿，不进在任列表。 */
export function wanderingOfficersInCity(state: GameState, cityId: CityId): Officer[] {
  return Object.values(state.officers).filter((o) => o.cityId === cityId && o.lordId === null)
}

/**
 * 城防守军（`16-ai-campaign`）：在该城、属本城势力、非俘虏，且未被任何待执行 campaign 征调的武将。
 * 出征在外者 cityId 仍滞留源城直到战斗结算（concludeBattle/quickResolveCampaign 才改写），故需显式排除；
 * 其余 busy（本月被即时/返回类命令占用）仍计为守军——月末回防。
 * 「无守军直接占城」判定、initBattle 自动选守、AI vs AI 速算守方均共用此口径。
 */
export function defendingOfficers(state: GameState, cityId: CityId): Officer[] {
  const city = state.cities[cityId]
  if (!city) return []
  const onCampaign = new Set<OfficerId>()
  for (const cmd of state.pendingCommands) {
    if (cmd.type === 'campaign') for (const id of cmd.officerIds) onCampaign.add(id)
  }
  // lordId===city.lordId 已蕴含「非俘虏」（俘虏定义为 lordId≠所在城 lordId）。
  return Object.values(state.officers).filter(
    (o) => o.cityId === cityId && o.lordId === city.lordId && !onCampaign.has(o.id)
  )
}

/** 本城俘虏（isCaptive 为真者）：招降/处斩的候选、UI 列示。派生，无第二份存储。 */
export function captivesInCity(state: GameState, cityId: CityId): Officer[] {
  return Object.values(state.officers).filter((o) => o.cityId === cityId && isCaptive(state, o.id))
}

/** 本城未发现道具（holder=本城 且 discovered=false）：搜寻发现的候选。 */
export function undiscoveredItemsInCity(state: GameState, cityId: CityId): Item[] {
  return Object.values(state.items).filter(
    (i) => i.holder.kind === 'city' && i.holder.cityId === cityId && !i.discovered
  )
}

/** 取归属某君主的全部城池（玩家方传 state.playerLordId）。 */
export function citiesOfLord(state: GameState, lordId: OfficerId): City[] {
  return Object.values(state.cities).filter((c) => c.lordId === lordId)
}

/** 取归属某城的道具（按 holder 派生，无第二份存储）。 */
export function itemsInCity(state: GameState, cityId: CityId): Item[] {
  return Object.values(state.items).filter(
    (i) => i.holder.kind === 'city' && i.holder.cityId === cityId
  )
}

/** 取归属某武将的道具（按 holder 派生），按装备先后 equipSeq 升序返回。 */
export function itemsOfOfficer(state: GameState, officerId: OfficerId): Item[] {
  return Object.values(state.items)
    .filter((i) => i.holder.kind === 'officer' && i.holder.officerId === officerId)
    .sort((a, b) => {
      const sa = a.holder.kind === 'officer' ? a.holder.equipSeq : 0
      const sb = b.holder.kind === 'officer' ? b.holder.equipSeq : 0
      return sa - sb
    })
}

/**
 * 有效武将（派生）：force/intel 叠加所持道具加成之和，其余字段原样。
 * 所有用到武力/智力的公式都应取此值——道具加成的唯一收敛处。
 */
export function effectiveOfficer(state: GameState, officerId: OfficerId): Officer {
  const officer = state.officers[officerId]!
  const items = itemsOfOfficer(state, officerId)
  if (items.length === 0) return officer
  const force = officer.force + items.reduce((s, i) => s + i.forceBonus, 0)
  const intelligence = officer.intelligence + items.reduce((s, i) => s + i.intelBonus, 0)
  return { ...officer, force, intelligence }
}

/**
 * 有效兵种（派生，不写回 Officer）：以基础兵种为起点，按所持道具装备先后（equipSeq 升序）
 * 逐件应用其改兵种结果，合法的后者覆盖前者。门槛取 effectiveOfficer 的有效武力/智力
 * （含该武将所持全部道具加成，包括被判定的这件），故没收道具会使兵种回退。
 */
export function effectiveTroopType(state: GameState, officerId: OfficerId): TroopType {
  const eff = effectiveOfficer(state, officerId)
  let current = eff.troopType
  for (const item of itemsOfOfficer(state, officerId)) {
    const next = resolveOverride(item.troopTypeOverride, eff.force, eff.intelligence)
    if (next !== null) current = next
  }
  return current
}

/** 移动力（派生，仅展示）= 有效兵种基础移动力 + 所持道具移动力加成之和。 */
export function officerMovement(state: GameState, officerId: OfficerId): number {
  const items = itemsOfOfficer(state, officerId)
  const bonus = items.reduce((sum, i) => sum + i.movementBonus, 0)
  return BASE_MOVEMENT[effectiveTroopType(state, officerId)] + bonus
}

/** 武将忠诚（派生）：君主（lordId===自身）恒 LOYALTY_MAX，否则取存储值。 */
export function officerLoyalty(state: GameState, officerId: OfficerId): number {
  const officer = state.officers[officerId]!
  return officer.lordId === officer.id ? LOYALTY_MAX : officer.loyalty
}

/**
 * 太守（派生，零存储字段）：某城的领头武将。
 * - 该城归属君主（id===city.lordId 的武将）正驻本城（其 cityId===本城）→ 返该君主。
 * - 否则 → 本城在任武将（lordId===city.lordId，自动排除俘虏/在野）中有效智力最高者，平局取 id 字典序最小。
 * - 空城 / 仅俘虏 → null。
 * 智力取 effectiveOfficer 有效值。仅服务策反（instigate）目标判定。
 */
export function governorOf(state: GameState, cityId: CityId): Officer | null {
  const city = state.cities[cityId]
  if (!city) return null
  const lord = state.officers[city.lordId]
  if (lord && lord.cityId === cityId) return lord
  const serving = Object.values(state.officers).filter(
    (o) => o.cityId === cityId && o.lordId === city.lordId
  )
  if (serving.length === 0) return null
  return serving.reduce((best, o) => {
    const oi = effectiveOfficer(state, o.id).intelligence
    const bi = effectiveOfficer(state, best.id).intelligence
    return oi > bi || (oi === bi && o.id < best.id) ? o : best
  })
}

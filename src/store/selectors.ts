import type { GameState } from '../core/game-state'
import type { City } from '../core/world/city'
import { citiesOfLord } from '../core/world/queries'

/**
 * UI ↔ core 的唯一通道（`19-store-ui`）：再导出 UI 所需的 core 查询与类型。
 * UI 一律 `from '../store/selectors'`，绝不直接 import core——把依赖收成严格 `ui → store → core`。
 */
export {
  officersInCity,
  captivesInCity,
  itemsInCity,
  itemsOfOfficer,
  undiscoveredItemsInCity,
  wanderingOfficersInCity,
  citiesOfLord,
  effectiveOfficer,
  effectiveTroopType,
  officerMovement,
  officerLoyalty,
  governorOf,
  isBusy,
  isCaptive,
  defendingOfficers,
} from '../core/world/queries'
export { successionCandidates } from '../core/world/succession'
export { troopCapacity } from '../core/world/officer'
export { SCENARIOS, lordsForScenario } from '../data/scenarios'

export type { GameState, PendingCommand } from '../core/game-state'
export type { Action, CommandResult } from '../core/game'
export type { CommandCheck, ReasonCode } from '../core/shared/command'
export type { OutcomeEvent } from '../core/shared/outcome'
export type { CityId, OfficerId, ItemId } from '../core/shared/ids'
export type { City, CityStatus } from '../core/world/city'
export type { Officer, Personality } from '../core/world/officer'
export type { Item } from '../core/world/item'
export type { TroopType } from '../core/world/troop-type'
export type {
  ScenarioId,
  ScenarioSummary,
  ScenarioLordSummary,
  CreateScenarioRequest,
} from '../data/scenarios'

/** 玩家全部城池（= citiesOfLord(game, game.playerLordId)）。 */
export const playerCities = (game: GameState): City[] => citiesOfLord(game, game.playerLordId)

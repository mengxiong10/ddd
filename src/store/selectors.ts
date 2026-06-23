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
// 开局预览（建局前拿城池布局；data 层只读摘要，零规则、不构造 GameState）。
export { scenarioPreview } from '../data/scenarios'
// 战斗只读查询（纯 selector，PRD 允许经 selectors 暴露；UI 不直接 import core）。
export { reachableTiles, attackableTiles, skillTargetTiles } from '../core/military/battle-movement'
export { availableSkills, SKILL_DEFS } from '../core/military/battle-skill'
export { terrainAt, isCityTile, GRID_SIZE } from '../core/military/battle-map'
export { aliveUnits, unitAt, sideTroops, computeDamage } from '../core/military/battle-core'

export type { GameState, PendingCommand } from '../core/game-state'
export type { Action, CommandResult } from '../core/game'
export type { CommandCheck, ReasonCode } from '../core/shared/command'
export type { OutcomeEvent } from '../core/shared/outcome'
export type { CityId, OfficerId, ItemId } from '../core/shared/ids'
export type { City, CityStatus } from '../core/world/city'
export type { Officer, Personality } from '../core/world/officer'
export type { Item } from '../core/world/item'
export type { TroopType } from '../core/world/troop-type'
export type { TradeMode } from '../core/economy/trade'
export type {
  ScenarioId,
  ScenarioSummary,
  ScenarioLordSummary,
  CreateScenarioRequest,
  ScenarioPreview,
  ScenarioPreviewCity,
} from '../data/scenarios'
export type { Position } from '../core/shared/position'
export type { Adjacency } from '../core/world/adjacency'
export type { SkillId, SkillDef } from '../core/military/battle-skill'
export type { Terrain, BattleMap } from '../core/military/battle-map'
export type {
  BattleState,
  BattleUnit,
  BattleAction,
  BattleSide,
  BattleMode,
  BattleOutcome,
} from '../core/military/battle'
export type { Weather } from '../core/military/battle-weather'
export type { BattleStatus } from '../core/military/battle-status'

/** 玩家全部城池（= citiesOfLord(game, game.playerLordId)）。 */
export const playerCities = (game: GameState): City[] => citiesOfLord(game, game.playerLordId)

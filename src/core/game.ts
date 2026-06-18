import type { GameState } from './game-state'
import type { CityId, ItemId, OfficerId } from './shared/ids'
import type { GameConfig } from './shared/config'
import type { CommandCheck } from './shared/command'
import { DEFAULT_CONFIG } from './shared/config'
import { canDevelop, develop } from './economy/develop'
import { canRecruit, recruit } from './economy/recruit'
import { canAllocate, allocate } from './economy/allocate'
import { canPlunder, plunder } from './economy/plunder'
import { canScout, scout } from './economy/scout'
import { canCampaign, campaign } from './economy/campaign'
import { canReward, reward, canConfiscate, confiscate } from './economy/reward'
import { canPatrol, patrol } from './economy/patrol'
import { canBanquet, banquet } from './economy/banquet'
import { canTrade, trade, type TradeMode } from './economy/trade'
import { canMove, move } from './economy/move'
import { canTransport, transport } from './economy/transport'
import { canSearch, search } from './economy/search'
import { canSuborn, suborn } from './economy/suborn'
import {
  canEntice, entice, canAlienate, alienate,
  canInstigate, instigate, canInduce, induce,
} from './economy/diplomacy'
import { canBehead, behead, canBanish, banish } from './economy/captive'
import { canGovern, govern } from './economy/govern'
import { endMonth, resumeMonth } from './turn/end-month'
import { canBattle, reduceBattle, type BattleAction } from './military/battle'

/**
 * 对外可派发的动作。reclaim/commerce/recruit/allocate 是「指令」（需 canApply 校验），
 * endMonth 是「阶段推进」（恒可执行）。所有状态变更只经由 apply 这一入口。
 */
export type Action =
  | { type: 'reclaim'; officerId: OfficerId } // 开垦 -> agriculture
  | { type: 'commerce'; officerId: OfficerId } // 招商 -> commerce
  | { type: 'recruit'; officerId: OfficerId; amount: number } // 征兵（占人）
  | { type: 'allocate'; officerId: OfficerId; amount: number } // 分配（不占人）
  | { type: 'plunder'; officerId: OfficerId } // 掠夺（占人，效果延到月末）
  | { type: 'scout'; officerId: OfficerId; targetCityId: CityId } // 侦察（占人，即时）
  | { type: 'campaign'; officerIds: readonly OfficerId[]; targetCityId: CityId; provisions: number } // 出征（占人，效果延到月末）
  | { type: 'reward'; officerId: OfficerId; itemId: ItemId } // 赏赐（不占人，即时）
  | { type: 'confiscate'; officerId: OfficerId; itemId: ItemId } // 没收（不占人，即时）
  | { type: 'patrol'; officerId: OfficerId } // 出巡（占人，即时）
  | { type: 'banquet'; officerId: OfficerId } // 宴请（不占人，即时）
  | { type: 'trade'; officerId: OfficerId; mode: TradeMode; amount: number } // 交易（占人，即时）
  | { type: 'move'; officerId: OfficerId; targetCityId: CityId } // 移动（占人，效果延到月末）
  | { type: 'transport'; officerId: OfficerId; targetCityId: CityId; food: number; gold: number; troops: number } // 输送（占人，效果延到月末）
  | { type: 'search'; officerId: OfficerId } // 搜寻（占人，效果延到月末）
  | { type: 'suborn'; officerId: OfficerId; captiveId: OfficerId } // 招降（占人，效果延到月末）
  | { type: 'entice'; officerId: OfficerId; targetOfficerId: OfficerId } // 招揽（占人，月末）
  | { type: 'alienate'; officerId: OfficerId; targetOfficerId: OfficerId } // 离间（占人，月末）
  | { type: 'instigate'; officerId: OfficerId; targetOfficerId: OfficerId } // 策反（占人，月末）
  | { type: 'induce'; officerId: OfficerId; targetOfficerId: OfficerId } // 劝降（占人，月末）
  | { type: 'behead'; captiveId: OfficerId } // 处斩（不占人，即时）
  | { type: 'banish'; officerId: OfficerId } // 流放（不占人，即时）
  | { type: 'govern'; officerId: OfficerId } // 治理（占人，即时）
  | { type: 'battle'; action: BattleAction } // 战斗推进（单包装委派 military/battle，不需 config）
  | { type: 'resumeMonth' } // 战斗分胜负后续跑月末（写回 + 续 campaign/尾段）
  | { type: 'endMonth' }

/** 校验动作能否执行；UI 用其结果置灰按钮并展示 reason。endMonth 恒可执行。 */
export function canApply(state: GameState, action: Action, config: GameConfig = DEFAULT_CONFIG): CommandCheck {
  switch (action.type) {
    case 'reclaim':
      return canDevelop(state, action.officerId, 'agriculture', config)
    case 'commerce':
      return canDevelop(state, action.officerId, 'commerce', config)
    case 'recruit':
      return canRecruit(state, action.officerId, action.amount, config)
    case 'allocate':
      return canAllocate(state, action.officerId, action.amount)
    case 'plunder':
      return canPlunder(state, action.officerId, config)
    case 'scout':
      return canScout(state, action.officerId, action.targetCityId, config)
    case 'campaign':
      return canCampaign(state, action.officerIds, action.targetCityId, action.provisions)
    case 'reward':
      return canReward(state, action.officerId, action.itemId)
    case 'confiscate':
      return canConfiscate(state, action.officerId, action.itemId)
    case 'patrol':
      return canPatrol(state, action.officerId, config)
    case 'banquet':
      return canBanquet(state, action.officerId, config)
    case 'trade':
      return canTrade(state, action.officerId, action.mode, action.amount, config)
    case 'move':
      return canMove(state, action.officerId, action.targetCityId)
    case 'transport':
      return canTransport(state, action.officerId, action.targetCityId, action.food, action.gold, action.troops, config)
    case 'search':
      return canSearch(state, action.officerId, config)
    case 'suborn':
      return canSuborn(state, action.officerId, action.captiveId, config)
    case 'entice':
      return canEntice(state, action.officerId, action.targetOfficerId, config)
    case 'alienate':
      return canAlienate(state, action.officerId, action.targetOfficerId, config)
    case 'instigate':
      return canInstigate(state, action.officerId, action.targetOfficerId, config)
    case 'induce':
      return canInduce(state, action.officerId, action.targetOfficerId, config)
    case 'behead':
      return canBehead(state, action.captiveId)
    case 'banish':
      return canBanish(state, action.officerId)
    case 'govern':
      return canGovern(state, action.officerId, config)
    case 'battle':
      return canBattle(state, action.action)
    case 'resumeMonth':
      return { ok: true }
    case 'endMonth':
      return state.activeBattle ? { ok: false, reason: '战斗进行中，请先结束战斗' } : { ok: true }
  }
}

/** 唯一状态变更入口：按 action 类型分派到对应领域服务，返回新状态（纯函数）。 */
export function apply(state: GameState, action: Action, config: GameConfig = DEFAULT_CONFIG): GameState {
  switch (action.type) {
    case 'reclaim':
      return develop(state, action.officerId, 'agriculture', config)
    case 'commerce':
      return develop(state, action.officerId, 'commerce', config)
    case 'recruit':
      return recruit(state, action.officerId, action.amount, config)
    case 'allocate':
      return allocate(state, action.officerId, action.amount)
    case 'plunder':
      return plunder(state, action.officerId, config)
    case 'scout':
      return scout(state, action.officerId, action.targetCityId, config)
    case 'campaign':
      return campaign(state, action.officerIds, action.targetCityId, action.provisions)
    case 'reward':
      return reward(state, action.officerId, action.itemId)
    case 'confiscate':
      return confiscate(state, action.officerId, action.itemId)
    case 'patrol':
      return patrol(state, action.officerId, config)
    case 'banquet':
      return banquet(state, action.officerId, config)
    case 'trade':
      return trade(state, action.officerId, action.mode, action.amount, config)
    case 'move':
      return move(state, action.officerId, action.targetCityId)
    case 'transport':
      return transport(state, action.officerId, action.targetCityId, action.food, action.gold, action.troops, config)
    case 'search':
      return search(state, action.officerId, config)
    case 'suborn':
      return suborn(state, action.officerId, action.captiveId, config)
    case 'entice':
      return entice(state, action.officerId, action.targetOfficerId, config)
    case 'alienate':
      return alienate(state, action.officerId, action.targetOfficerId, config)
    case 'instigate':
      return instigate(state, action.officerId, action.targetOfficerId, config)
    case 'induce':
      return induce(state, action.officerId, action.targetOfficerId, config)
    case 'behead':
      return behead(state, action.captiveId)
    case 'banish':
      return banish(state, action.officerId)
    case 'govern':
      return govern(state, action.officerId, config)
    case 'battle':
      return reduceBattle(state, action.action)
    case 'resumeMonth':
      return resumeMonth(state, config)
    case 'endMonth':
      return endMonth(state, config)
  }
}

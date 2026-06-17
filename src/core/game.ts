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
import { endMonth } from './turn/end-month'

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
    case 'endMonth':
      return { ok: true }
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
    case 'endMonth':
      return endMonth(state, config)
  }
}

import type { GameState } from './game-state'
import type { CityId, OfficerId } from './shared/ids'
import type { GameConfig } from './shared/config'
import { DEFAULT_CONFIG } from './shared/config'
import { canDevelop, develop, type DevelopCheck } from './economy/develop'
import { endMonth } from './turn/end-month'

/**
 * 对外可派发的动作。reclaim/commerce 是「经营指令」（需 canApply 校验），
 * endMonth 是「阶段推进」（恒可执行）。所有状态变更只经由 apply 这一入口。
 */
export type Action =
  | { type: 'reclaim'; cityId: CityId; officerId: OfficerId } // 开垦 -> agriculture
  | { type: 'commerce'; cityId: CityId; officerId: OfficerId } // 招商 -> commerce
  | { type: 'endMonth' }

/** 校验动作能否执行；UI 用其结果置灰按钮并展示 reason。endMonth 恒可执行。 */
export function canApply(state: GameState, action: Action, config: GameConfig = DEFAULT_CONFIG): DevelopCheck {
  switch (action.type) {
    case 'reclaim':
      return canDevelop(state, action.cityId, action.officerId, 'agriculture', config)
    case 'commerce':
      return canDevelop(state, action.cityId, action.officerId, 'commerce', config)
    case 'endMonth':
      return { ok: true }
  }
}

/** 唯一状态变更入口：按 action 类型分派到对应领域服务，返回新状态（纯函数）。 */
export function apply(state: GameState, action: Action, config: GameConfig = DEFAULT_CONFIG): GameState {
  switch (action.type) {
    case 'reclaim':
      return develop(state, action.cityId, action.officerId, 'agriculture', config)
    case 'commerce':
      return develop(state, action.cityId, action.officerId, 'commerce', config)
    case 'endMonth':
      return endMonth(state, config)
  }
}

import type { GameState } from './game-state'
import type { OfficerId } from './shared/ids'
import type { GameConfig } from './shared/config'
import type { CommandCheck } from './shared/command'
import type { WithCheck } from './shared/outcome'
import { DEFAULT_CONFIG } from './shared/config'
import { type EconomyAction, isEconomyAction, economyCan, economyCall } from './economy'
import {
  endMonthWithEvents,
  resumeMonth,
  chooseSuccessor,
  chooseDefenders,
  canChooseDefenders,
} from './turn/end-month'
import { canChooseSuccessor } from './world/succession'
import { canBattle, reduceBattleWithEvents, type BattleAction } from './military/battle'

/**
 * 阶段推进动作（非经营命令）：无 canX 自报告改造，由 game.ts 直接分派。
 * battle 委派 military/battle；resumeMonth/endMonth/chooseSuccessor/chooseDefenders 委派 turn。
 */
export type PhaseAction =
  | { type: 'battle'; action: BattleAction } // 战斗推进（单包装委派 military/battle，不需 config）
  | { type: 'resumeMonth' } // 战斗分胜负后续跑月末（写回 + 续 campaign/尾段）
  | { type: 'chooseSuccessor'; officerId: OfficerId } // 玩家君主遭劫后手动立新君（续跑月末）
  | { type: 'chooseDefenders'; officerIds: readonly OfficerId[] } // AI 进攻玩家城后玩家选守军开战/弃守
  | { type: 'endMonth' }

/**
 * 对外可派发的动作 = 经营命令（EconomyAction，注册于 economy/registry）+ 阶段动作（PhaseAction）。
 * 所有状态变更只经由 apply 这一入口。
 */
export type Action = EconomyAction | PhaseAction

/** 校验动作能否执行；UI 用其结果置灰按钮并展示 reason。endMonth 恒可执行。 */
export function canApply(
  state: GameState,
  action: Action,
  config: GameConfig = DEFAULT_CONFIG
): CommandCheck {
  if (isEconomyAction(action)) return economyCan(state, action, config)
  switch (action.type) {
    case 'battle':
      return canBattle(state, action.action)
    case 'resumeMonth':
      return { ok: true }
    case 'chooseSuccessor':
      return canChooseSuccessor(state, action.officerId)
    case 'chooseDefenders':
      return canChooseDefenders(state, action.officerIds)
    case 'endMonth':
      if (state.activeBattle) return { ok: false, reason: 'battle-in-progress' }
      if (state.pendingSuccession) return { ok: false, reason: 'pending-succession' }
      if (state.pendingDefense) return { ok: false, reason: 'pending-defense' }
      return { ok: true }
  }
}

/**
 * 下令结果（`18-command-feedback`）：校验结果（ok/reason）与 状态/事件 并列。
 * = CommandCheck & WithEvents<GameState> = { ok, reason?, state, events }。
 */
export type CommandResult = WithCheck<GameState>

/**
 * 富入口：按 action 分派，返回 CommandResult（ok/reason/state/events 一次到手，`18-command-feedback`）。
 * 经营命令直接转发 registry 各 call 的**自报告** CommandResult（校验在 call 内只跑一次）；
 * 阶段动作自身无 canX 自报告，合并 canApply 取 ok/reason（与其内部守卫有一次轻量重复，按点击节奏可忽略）。
 */
export function applyWithEvents(
  state: GameState,
  action: Action,
  config: GameConfig = DEFAULT_CONFIG
): CommandResult {
  if (isEconomyAction(action)) return economyCall(state, action, config)
  switch (action.type) {
    case 'battle':
      return {
        ...canApply(state, action, config),
        ...reduceBattleWithEvents(state, action.action),
      }
    case 'resumeMonth':
      return { ...canApply(state, action, config), ...resumeMonth(state, config) }
    case 'chooseSuccessor':
      return {
        ...canApply(state, action, config),
        ...chooseSuccessor(state, action.officerId, config),
      }
    case 'chooseDefenders':
      return {
        ...canApply(state, action, config),
        ...chooseDefenders(state, action.officerIds, config),
      }
    case 'endMonth':
      return { ...canApply(state, action, config), ...endMonthWithEvents(state, config) }
  }
}

/** 唯一状态变更入口（简化包装）：丢弃 ok/reason/事件、只取新状态；行为与既往逐字节一致。 */
export function apply(
  state: GameState,
  action: Action,
  config: GameConfig = DEFAULT_CONFIG
): GameState {
  return applyWithEvents(state, action, config).state
}

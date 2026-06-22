import { createStore, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { GameState } from '../core/game-state'
import type { GameConfig } from '../core/shared/config'
import { DEFAULT_CONFIG } from '../core/shared/config'
import type { Action, CommandResult } from '../core/game'
import { applyWithEvents, canApply } from '../core/game'
import type { CommandCheck, ReasonCode } from '../core/shared/command'
import type { OutcomeEvent } from '../core/shared/outcome'
import { createScenarioState, type CreateScenarioRequest } from '../data/scenarios'

/**
 * 瞬态反馈项（`19-store-ui`）：core 结构化反馈 + 自增 id（UI keying + 定时出队）。
 * 成功的 OutcomeEvent 逐条、失败的 ReasonCode 单条。**不进 GameState、不持久化**。
 */
export interface FeedbackItem {
  readonly id: number
  readonly payload:
    | { readonly kind: 'event'; readonly event: OutcomeEvent }
    | { readonly kind: 'failure'; readonly action: Action['type']; readonly reason: ReasonCode }
    // 下令成功确认（纯 UI 台词，core 不产；带完整 action 供按执行人/模式选台词，多数命令 UI 映射为 null 不弹）。
    | { readonly kind: 'issued'; readonly action: Action }
}

/**
 * 应用状态层（zustand）：持有当前对局 + 配置 + 反馈队列；唯一写 game 的地方。
 * 零规则、零中文——dispatch 转发 core 的 applyWithEvents、入队结构化反馈。
 */
export interface GameStore {
  readonly game: GameState | null
  readonly config: GameConfig
  readonly feedback: readonly FeedbackItem[]
  /** 派发指令：成功更新 game + 逐条入队 events，失败入队 reason；恒返回 core 的 CommandResult。 */
  dispatch(action: Action): CommandResult
  /** 派发前预判（= canApply）：供 UI 置灰/提示，不改状态。 */
  canDispatch(action: Action): CommandCheck
  /** 出队一条反馈。 */
  dismiss(id: number): void
  /** 清空反馈队列。 */
  clearFeedback(): void
  /** 创建正式剧本对局：替换 game、清空 feedback，可同时替换配置。 */
  newGame(request: CreateScenarioRequest, config?: GameConfig): void
}

export interface CreateGameStoreOptions {
  readonly initialGame?: GameState | null
  readonly config?: GameConfig
}

function requireGame(game: GameState | null): GameState {
  if (!game) throw new Error('game has not started')
  return game
}

/** 无头工厂：正式默认无对局；测试可显式注入 fixture。 */
export function createGameStore(options: CreateGameStoreOptions = {}): StoreApi<GameStore> {
  let nextId = 1
  const initialGame = options.initialGame ?? null
  const initialConfig = options.config ?? DEFAULT_CONFIG
  const eventItem = (event: OutcomeEvent): FeedbackItem => ({
    id: nextId++,
    payload: { kind: 'event', event },
  })
  const failureItem = (action: Action['type'], reason: ReasonCode): FeedbackItem => ({
    id: nextId++,
    payload: { kind: 'failure', action, reason },
  })
  const issuedItem = (action: Action): FeedbackItem => ({
    id: nextId++,
    payload: { kind: 'issued', action },
  })

  return createStore<GameStore>((set, get) => ({
    game: initialGame,
    config: initialConfig,
    feedback: [],
    dispatch(action) {
      const { game, config, feedback } = get()
      const result = applyWithEvents(requireGame(game), action, config)
      if (result.ok) {
        set({
          game: result.state,
          feedback: [...feedback, issuedItem(action), ...result.events.map(eventItem)],
        })
      } else {
        set({ feedback: [...feedback, failureItem(action.type, result.reason!)] })
      }
      return result
    },
    canDispatch(action) {
      return canApply(requireGame(get().game), action, get().config)
    },
    dismiss(id) {
      set({ feedback: get().feedback.filter((f) => f.id !== id) })
    },
    clearFeedback() {
      set({ feedback: [] })
    },
    newGame(request, config) {
      set({
        game: createScenarioState(request),
        feedback: [],
        ...(config ? { config } : {}),
      })
    },
  }))
}

/** 默认单例（app 用）：首次启动无对局，必须先走剧本选择。 */
export const gameStore = createGameStore()

/** React 绑定钩子：useGameStore(s => s.game) 订阅。 */
export function useGameStore<T>(selector: (s: GameStore) => T): T {
  return useStore(gameStore, selector)
}

/** 仅供已确认存在对局的 UI 子树使用；误用即抛程序错误，不传播 nullable。 */
export function useCurrentGame(): GameState {
  return requireGame(useGameStore((state) => state.game))
}

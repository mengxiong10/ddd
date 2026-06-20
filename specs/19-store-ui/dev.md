# store-ui 开发文档

## 方案概述

首次接通 `ui → store → core`。重心是 **store 层**：一个 zustand **vanilla store**（`createStore`，无头、node 环境可直接单测，与 core headless 可测同调），持有当前 `GameState` + `GameConfig` + 一个**瞬态反馈队列**；对外暴露 `dispatch` / `canDispatch` / `dismiss` / `clearFeedback` / `newGame`。React 侧用 `useGameStore` 钩子订阅。

关键取舍：

- **反馈队列在 store 自身状态、不进 `GameState`**：每次 `dispatch` 把成功的 `OutcomeEvent` 逐条、失败的 `ReasonCode` 单条包成带**自增 id** 的 `FeedbackItem` 入队（id 供 UI keying + 定时出队）。队列零中文、不挑台词、不写规则——只搬运 core 的结构化反馈。`GameState` 零新增字段，沿用 `18` 的"事件不进聚合"。
- **`dispatch(action)` 返回 `CommandResult`**：直接转发 `applyWithEvents` 的结果（`ok/reason/state/events`），供调用处做后续反应（如侦察后弹目标城详情）；副作用是更新 `game` 与入队反馈。
- **store 包装 selector（UI 只依赖 store）**：`src/store/selectors.ts` 再导出 UI 需要的 core `queries` 与核心类型，UI 一律 `from '../store/...'`，绝不直接 import `core`——把 `ui → store → core` 收成严格两段，UI 整体可替换。store→core 合法（向下依赖）。
- **战棋干净切出本切片**：UI **不接 `campaign`**；`pendingDefense` 只给「弃守」（`chooseDefenders([])`）；`pendingSuccession` 给最小选君弹窗（`chooseSuccessor`）；`activeBattle` 仅只读占位——因 AI 攻玩家城先经 `pendingDefense`、玩家又不主动出征，最小 UI 流程里 `activeBattle` 不会被置上。交互式战棋 UI 留后续切片。
- **中文文案唯一落点 = UI 映射模块**：`src/ui/feedback/messages.ts` 把 `OutcomeEvent`/`ReasonCode` → 中文（多变体台词在此 `Math.random` 随机挑选，非 core RNG），对照 `docs/business-command-rules.md`。**可见性过滤也在此**（core actor-agnostic 会产出 AI 的月末事件）：非玩家相关事件 `feedbackText` 返回 `null`，ToastHost 跳过并即时出队。
- **本切片不做存档**：刷新即丢，`newGame(seed, config?)` 重置（`config` 可注入便于测试）。

## 接口设计

```ts
// src/store/game-store.ts —— store 形状 + 工厂 + React 钩子
import type { StoreApi } from 'zustand/vanilla'

export interface FeedbackItem {
  readonly id: number // 自增，UI keying + dismiss
  readonly payload:
    | { readonly kind: 'event'; readonly event: OutcomeEvent }
    | { readonly kind: 'failure'; readonly action: Action['type']; readonly reason: ReasonCode }
}

export interface GameStore {
  readonly game: GameState
  readonly config: GameConfig
  readonly feedback: readonly FeedbackItem[]
  /** 派发指令：走 applyWithEvents；成功更新 game + 逐条入队 events，失败入队 reason；恒返回 CommandResult。 */
  dispatch(action: Action): CommandResult
  /** 派发前预判（= canApply）：UI 置灰/提示，不改状态。 */
  canDispatch(action: Action): CommandCheck
  /** 出队一条反馈（UI 定时器到点调用）。 */
  dismiss(id: number): void
  /** 清空反馈队列。 */
  clearFeedback(): void
  /** 重开局（fixture 播种）：替换 game、清空 feedback、可注入 seed/config。 */
  newGame(seed: number, config?: GameConfig): void
}

/** 无头工厂：测试直接 createGameStore(seed).getState().dispatch(...)。 */
export function createGameStore(seed: number, config?: GameConfig): StoreApi<GameStore>
/** 默认单例 + React 绑定钩子：useGameStore(selector)。 */
export const gameStore: StoreApi<GameStore>
export function useGameStore<T>(selector: (s: GameStore) => T): T

// src/store/selectors.ts —— 再导出 UI 所需 core 查询与类型（UI 只依赖 store）
export {
  officersInCity,
  captivesInCity,
  itemsInCity,
  itemsOfOfficer,
  undiscoveredItemsInCity,
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
export const playerCities: (game: GameState) => City[] // = citiesOfLord(game, game.playerLordId)
export type { GameState, Action, CommandResult, CommandCheck, ReasonCode, OutcomeEvent }
export type { City, Officer, Item, PendingCommand }

// src/ui/feedback/messages.ts —— 反馈 → 中文（唯一中文文案落点）
export function reasonText(reason: ReasonCode): string
/** 非玩家相关事件返回 null（不展示）；多变体台词 Math.random 挑选。 */
export function feedbackText(item: FeedbackItem, game: GameState): string | null
```

`dispatch` 实现要点（仅签名级，不写体）：`const r = applyWithEvents(game, action, config)`；`r.ok` 则 `set({ game: r.state, feedback: [...feedback, ...r.events.map(toEventItem)] })`，否则 `set({ feedback: [...feedback, toFailureItem(action.type, r.reason!)] })`；末了 `return r`。自增 id 由闭包计数器或 store 内 `nextId` 提供。

## 模块职责

- `src/store/game-store.ts`：store 形状 + `createGameStore` 工厂 + 默认单例 + `useGameStore` 钩子。唯一写 `game` 的地方；薄、不写规则。
- `src/store/selectors.ts`：UI ↔ core 的**唯一**通道——再导出 core 查询与类型 + 极少量组合 selector（`playerCities`）。隔离 UI 对 core 的直接依赖。
- `src/ui/feedback/messages.ts`：结构化反馈 → 中文（含多变体随机 + 可见性过滤）。唯一中文运行时文案落点。
- `src/ui/feedback/toast.tsx`：`ToastHost` 订阅 `feedback`，渲染 toast，`setTimeout` 到点调 `dismiss`；`feedbackText` 为 `null` 的项即时出队不渲染。
- `src/ui/app-shell.tsx`（或拆 HeaderBar/CityList/CityPanel/OfficerCommands）：经营闭环界面——选城、城属性、武将（在任/占用/俘虏）与道具列示、即时类指令面板、月末按钮。
- `src/ui/pause-dialogs.tsx`：`SuccessionDialog`（列 `successionCandidates` → `chooseSuccessor`）+ `DefenseDialog`（「弃守」→ `chooseDefenders([])`）。
- `src/App.tsx`：组合 app-shell + ToastHost + pause-dialogs。

## 要测的行为

（仅 store 层，node 环境；UI 不强制测试）

- [x] `createGameStore(seed)` 初始 `game` 即 fixture 局面（year=189、month=1、playerLordId=liubei），`feedback` 为空。
- [x] `dispatch` 即时指令成功（如 `reclaim`）：`game` 对应城属性更新，队列追加一条 `event`(develop-done) FeedbackItem，返回 `ok:true`。
- [x] `dispatch` 失败（如金/体力不足）：`game` 不变（与派发前逐字段一致），队列追加一条 `failure` FeedbackItem（带正确 `reason`），返回 `ok:false` + `reason`。
- [x] `dispatch({type:'endMonth'})` 推进月份；先入队一条 `plunder` 再 endMonth → 队列含 `plunder-done` 事件（月末多事件全部入队）。
- [x] `canDispatch(action)` 返回与 `canApply` 一致的 `ok/reason`，且不改状态。
- [x] `dismiss(id)` 仅移除该项；`clearFeedback()` 清空。
- [x] FeedbackItem 的 `id` 唯一且单调递增。
- [x] `newGame(seed2)` 替换 `game`、清空 `feedback`。

## 新建文件

- `src/store/game-store.ts`：store 工厂 + 钩子。
- `src/store/selectors.ts`：core 查询/类型再导出 + 组合 selector。
- `src/store/game-store.test.ts`：store 行为单测（node）。
- `src/ui/feedback/messages.ts`：反馈 → 中文映射。
- `src/ui/feedback/toast.tsx`：ToastHost + Toast。
- `src/ui/app-shell.tsx`：经营闭环主界面（HeaderBar/CityList/CityPanel/OfficerCommands 可同文件或就近拆分）。
- `src/ui/pause-dialogs.tsx`：选君 / 弃守 弹窗。
- `src/ui/styles.css`：极简样式（throwaway）。

## 修改文件

- `src/App.tsx`：由占位改为组合 app-shell + ToastHost + pause-dialogs。
- `src/main.tsx`：如需引入 `styles.css`。
- `package.json`：新增依赖 `zustand`（用 npm 装最新）。

## 任务清单

- [x] 装 `zustand`；建 store 骨架（`game/config/feedback` + `newGame`），单测：初始 fixture 局面 + `newGame` 重置。
- [x] `dispatch`（走 `applyWithEvents`、成功更新+入队事件、失败入队 reason、返回 CommandResult）+ `canDispatch` + `dismiss`/`clearFeedback`，单测覆盖上述行为清单（8 测全绿）。
- [x] `selectors.ts`：再导出 core 查询与类型 + `playerCities`。
- [x] `messages.ts`：`reasonText`（穷举 Record）+ `feedbackText`（多变体随机 + 非玩家事件返回 null），对照 business-command-rules.md。
- [x] `toast.tsx`：ToastHost 订阅 + 定时出队 + null 跳过。
- [x] `app-shell.tsx`：选城 / 城属性 / 武将+道具列示 / 即时类指令面板（reclaim/commerce/patrol/govern/banquet/banish + recruit/allocate/trade 数值 + reward/confiscate 选道具 + suborn/behead 俘虏）/ 月末 + 新游戏按钮；按钮置灰走 `canDispatch`。
- [x] `pause-dialogs.tsx`：`pendingSuccession` 选君、`pendingDefense` 弃守。
- [x] `App.tsx` 组合 + `src/vite-env.d.ts`（css 副作用导入声明）+ `styles.css`；`npm run dev` 起服、全模块转换 200、闭环可跑。

## TDD：是（仅 store 层）

UI 组件与 `messages.ts` 不强制测试（总纲：UI 不强制）；store 行为走红绿。

## 风险 / 待定

- **可见性过滤放 UI**：core 产出含 AI 月末事件，`feedbackText` 对非玩家相关事件返回 `null`、ToastHost 即时出队。判定口径（事件涉及的 officer/city 是否属 `playerLordId`，系统级如势力归降/灭亡/被策反全局可见）落在 messages.ts，实现时按 business-rules「只展示玩家相关」细化。
- **目标类指令（scout/move/transport/suborn/外交）UI 暂缓**：store 已 action-complete 全量支持，但最小 UI 先只接无目标/数值/选道具类即时指令；目标选择器（选敌城/敌将）可后续补，不阻塞闭环。
- **store `dispatch` 直接读自身 `game/config`**：vanilla store 用 `get()` 取当前态，避免闭包旧值。
- **多 toast 自增 id**：用 store 内 `nextId` 计数器（或 selectors 外的模块计数器）；`newGame` 不必重置 id（仅清队列）。
- **交互式战棋 / 存档** 明确不在本切片（已与范围决策对齐）。
- **实现中发现并已修复的预存 core 类型错误（非本切片引入，曾阻塞 `npm run build` 的 `tsc -b`）**：①`military/battle-ai.ts` `selectUnitId` 形参 `state` 未使用（`noUnusedParameters`）→ 删去该死参 + 更新唯一调用方；②`turn/end-month.ts` `chooseDefenders` 给 `initBattle` 多传第 5 个实参（玩家选定守军），但 `initBattle` 仍是 4 参且自动选守——属 `16-ai-campaign`（`ready`、未 `done`）的未完成实现。**按 `16-ai-campaign` dev.md 既定设计补全**：`initBattle` 新增可选 `explicitDefenderIds`（玩家防守时由 `chooseDefenders` 传入已选子集），自动路改用 `defendingOfficers(target)`，两路均「太守领衔（若在守军内）+ 兵力降序」、限 10。修复后 `npm run typecheck` / `npm run build` 全绿、566 测试与 lint 不回归。
- **教训**：勿用 `git stash` 在含大量未跟踪新文件时去“临时测干净 HEAD”——pop 易失败致工作丢失（本次已恢复）；改用临时改名或只读核查。

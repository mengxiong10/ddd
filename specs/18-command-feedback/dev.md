# command-feedback 开发文档

## 方案概述

让 `core` 产出零中文的命令反馈，分两条独立可测的轴：

1. **失败 → reason code**：把所有 `canX` 的 `CommandCheck.reason` 由中文串改为 `shared/command.ts` 的 `ReasonCode` 字符串字面量联合（跨命令复用 `officer-not-found` / `gold-insufficient` / `is-captive` 等）。核心层不再出现中文**反馈串**。
2. **成功/结算/系统 → OutcomeEvent**：事件与 state **并列返回**（**不放进 `GameState`**——瞬态反馈不污染持久聚合）。产事件的函数返回 `WithEvents<GameState> = { state, events }`，orchestrator 用 `step`/`lift` 组合子逐层 thread 并拼接事件。新增入口 `applyWithEvents(state, action, config) → { state, events }`；原 `apply` 退化为只取 `.state` 的简化包装，签名与现有行为不变。

关键取舍：

- **事件与 state 并列、不进 GameState**：瞬态反馈不进根聚合，省去存档剔除/全等比较的负担。代价：**事件产出路径**上的函数（producers + 其所在 orchestrator）签名由 `state→state` 改为 `→ WithEvents<GameState>`；纯步骤经 `lift` 提升、无需逐个改。**非事件路径**的月末执行类（settle/debut/aiTakeTurn 等）保持 `state→state` 原样。（**后续 follow-up**：下令函数已统一为自报告 `CommandResult`，详见下文「接口统一」——allocate/recruit/trade/reward 等也随之返回 `CommandResult`，非下令的月末执行类不变。）
- **事件不消耗 `GameState.rng`**：产事件只构造对象、不掷骰；多变体台词由 UI 随机挑选，core 不参与。
- **只为"携数据/决结果分支"产事件**：随机增量（开垦/招商/治理/出巡）、月末结算结果（搜寻/掠夺/输送/招降/外交）、系统事件。纯确认（"部队已出发""马上出发"）与 UI 已知数据（征兵/交易/分配量、赏赐/没收目标）由 UI 自行推导，**不产 core 事件**。
- **core 仍 actor-agnostic**：事件无差别产出（含 AI 经由现有执行器入队的月末命令），"是否玩家可见"的过滤是 UI 的事，不在 core 判。

### 验收口径澄清（修订 PRD）

PRD 验收"`src/core/` 全树无中文"应精确为：**命令反馈相关的运行时字符串无中文**（`ReasonCode` 取值、`OutcomeEvent` 的 `kind`/枚举值）。**不含**：中文注释、领域数据（武将/城/道具名等 fixture 文本）——后者是数据非反馈文案，保持原样。

## 接口设计

```ts
// shared/command.ts —— reason 由中文串改为 code 联合
export type ReasonCode =
  | 'officer-not-found' | 'officer-busy' | 'is-captive' | 'city-not-found'
  | 'gold-insufficient' | 'stamina-insufficient' | 'food-insufficient'
  | 'reserve-troops-insufficient' | 'agriculture-capped' | 'commerce-capped'
  | 'prevention-capped' | 'target-city-not-found' | 'target-is-self-city'
  | 'target-not-friendly-city' | 'target-not-adjacent' | 'invalid-amount'
  | 'target-not-enemy-officer' | 'target-not-enemy-governor' | 'target-not-enemy-lord'
  | 'cannot-induce-own-lord' | 'city-power-insufficient' | ... // 全集见「修改文件」逐处映射
export interface CommandCheck {
  readonly ok: boolean
  readonly reason?: ReasonCode
}

// shared/outcome.ts（新）—— 判别式事件联合 + 并列通道助手
export type OutcomeEvent =
  // 即时经营（apply 时产出）
  | { kind: 'develop-done'; officerId; cityId; attr: 'agriculture' | 'commerce'; newValue: number; delta: number }
  | { kind: 'govern-done'; officerId; cityId; newPrevention: number; delta: number }
  | { kind: 'patrol-done'; officerId; cityId; newLoyalty: number; loyaltyDelta: number }
  // 月末经营结算
  | { kind: 'search-none'; officerId; cityId }
  | { kind: 'search-recruited'; officerId; cityId; targetId: OfficerId }
  | { kind: 'search-found-not-recruited'; officerId; cityId; targetId: OfficerId }
  | { kind: 'search-item'; officerId; cityId; itemId: ItemId }
  | { kind: 'search-resource'; officerId; cityId; resource: 'gold' | 'food'; amount: number }
  | { kind: 'plunder-done'; officerId; cityId; goldGained: number; foodGained: number }
  | { kind: 'transport-delivered'; officerId; targetCityId; food; gold; troops }
  | { kind: 'transport-robbed'; officerId; targetCityId }
  | { kind: 'suborn-result'; officerId; captiveId; success: boolean }
  // 外交月末结算
  | { kind: 'diplomacy-result'; command: 'entice' | 'alienate' | 'instigate' | 'induce'
      ; officerId; targetOfficerId; success: boolean }
  // 系统事件（月末/战后/外交领土变更）
  | { kind: 'lord-surrendered'; fromLordId: OfficerId; toLordId: OfficerId }      // 势力归降（劝降成功）
  | { kind: 'lord-instigated'; officerId: OfficerId; fromLordId: OfficerId }      // 被策反成为君主
  | { kind: 'city-disaster'; cityId; status: 'famine' | 'drought' | 'flood' | 'riot' }
  | { kind: 'city-recovered'; cityId }
  | { kind: 'lord-stricken'; lordId: OfficerId }                                  // 君主遭劫
  | { kind: 'succession-pending'; lordId: OfficerId }                             // 请玩家拥立新君
  | { kind: 'lord-succeeded'; oldLordId: OfficerId; newLordId: OfficerId }        // 新君主产生
  | { kind: 'lord-eliminated'; lordId: OfficerId }                               // 势力灭亡

// 并列通道：事件与 state 并列，绝不进 GameState
export type WithEvents<S> = { readonly state: S; readonly events: readonly OutcomeEvent[] }
export const withEvents = <S>(state: S, events?: readonly OutcomeEvent[]): WithEvents<S>
// 串接一个产事件步骤并拼接事件：step(prev, fn) = { state: fn(prev.state).state, events: [...prev.events, ...fn(...).events] }
export function step<S>(prev: WithEvents<S>, fn: (s: S) => WithEvents<S>): WithEvents<S>
// 提升纯 state->state 步骤（产空事件）：lift(fn)(s) = withEvents(fn(s))
export const lift = <S>(fn: (s: S) => S): ((s: S) => WithEvents<S>)

// game.ts —— 富入口 + 简化包装；GameState 不含 events
export function applyWithEvents(state, action, config?): WithEvents<GameState>   // = dispatch(...)
export function apply(state, action, config?): GameState                        // = applyWithEvents(...).state
```

要点：`GameState` **不新增任何字段**。事件只活在 `WithEvents` 元组里，经 producers→orchestrators→`applyWithEvents` 逐层拼接；`apply` 丢弃事件、行为与今日逐字节一致。store 永远拿不到也不持久化事件（只在需要提示时改用 `applyWithEvents`）。

### 接口统一（后续 follow-up：下令自报告 `CommandResult`）

本切片落地后做了一次接口统一，解决「下令失败外层拿不到 `reason`」「`develop`(WithEvents) 与 `search`(GameState) 签名不一致」：

```ts
// shared/outcome.ts —— 校验结果 + 状态/事件并列
export type WithCheck<S> = CommandCheck & WithEvents<S>           // { ok, reason?, state, events }
export const commandOk   = <S>(state: S, events?): WithCheck<S>  // { ok: true, state, events }
export const commandFail = <S>(check: CommandCheck, state: S)    // { ...check, state, events: [] }
// game.ts
export type CommandResult = WithCheck<GameState>
export function applyWithEvents(state, action, config?): CommandResult
export function apply(state, action, config?): GameState         // = applyWithEvents(...).state
```

- **每个下令 X 一律返回 `CommandResult`**（develop/govern/patrol 与 trade/allocate/campaign/plunder/move/scout/search/banquet/behead/banish/suborn/recruit/transport/reward/confiscate/entice/alienate/instigate/induce）：X **自报告**——内部本就计算的 `canX` 结果一并带出，**失败** `commandFail(check, state)`、**成功** `commandOk(next, [event?])`。**校验只在 X 内跑一次**，`reason` 经 X→`applyWithEvents`→`apply` 自然冒泡。
- `applyWithEvents` 经营动作直接转发 X 的 `CommandResult`；5 个**阶段动作**（battle/resumeMonth/endMonth/chooseSuccessor/chooseDefenders 无 canX 自报告改造）合并 `canApply` 取 `ok/reason`。`canApply`/`canX` 保留供 UI 派发前预判。
- **不加 `command-issued`**（纯确认不产事件维持原样）。月末执行类（executeX/settle/debut/aiTakeTurn/succession 工具）非下令，签名不变。

## 模块职责

- `shared/command.ts`：`ReasonCode` 联合 + `CommandCheck`（reason 改 code）。单一真相源，全命令复用。
- `shared/outcome.ts`（新）：`OutcomeEvent` 判别式联合 + `WithEvents<S>`/`withEvents`/`step`/`lift` 组合子。泛型化、不 import `GameState`，无循环依赖。
- `game.ts`：`dispatch` 的 switch 直接返回 `WithEvents<GameState>`；`applyWithEvents = dispatch`，`apply = applyWithEvents(...).state`。
- 各 producer：在已算出结果的 `return` 处返回 `withEvents(nextState, [event])`（no-op 返回 `withEvents(state)`）——develop/govern/patrol/plunder/search/transport/suborn/diplomacy。
- 各 orchestrator（`turn/end-month`、`turn/pending`）：用 `step`/`lift` 折叠子步骤、拼接事件后返回 `WithEvents`；纯子步骤（settle/recoverStamina/runDebuts/aiTakeTurn 等）用 `lift` 提升。
- `world/disaster.ts`：灾害生成/恢复返回 `WithEvents`，产 `city-disaster`/`city-recovered`。
- `military/aftermath.ts` + `world/succession.ts`：君主遭劫/灭亡/立新君返回 `WithEvents`，产对应系统事件；`turn/end-month` 在设 `pendingSuccession` 处产 `succession-pending`。

## 要测的行为

- [x] `applyWithEvents` 对 `reclaim` 返回 `{ state, events: [develop-done] }`（attr/newValue/delta 正确）；`apply` 返回的 state 与引入前逐字段一致（`GameState` 无 events 字段）。
- [x] 失败校验返回 `ReasonCode`（如金不足 → `gold-insufficient`），无中文。
- [x] **确定性回归**：一整局经 `apply` 推进，`state.rng` 与各域状态与引入前逐字节一致（现有测试全绿、无需调随机期望）。
- [x] 月末搜寻按分支产出对应 `search-*` 事件（无事/招募/听闻未招/道具/金/粮）。
- [x] 月末掠夺产出 `plunder-done`（goldGained/foodGained 与城收益一致）。
- [x] 输送送达/被劫分别产出 `transport-delivered`/`transport-robbed`。
- [x] 招降、四种外交分别产出成败事件；劝降成功附带 `lord-surrendered`、策反成功附带 `lord-instigated`。
- [x] 灾害生成产出 `city-disaster`（城+灾种）。
- [x] 出征致敌君主遭劫 → `lord-stricken` +（AI 自动）`lord-succeeded` 或（玩家）`succession-pending`；无城 → `lord-eliminated`。

## 新建文件

- `src/core/shared/outcome.ts`：`OutcomeEvent` 联合 + `WithEvents`/`withEvents`/`step`/`lift`。
- `src/core/shared/outcome.test.ts`：`step`/`lift` 拼接事件、`withEvents` 形态。

## 修改文件

- `src/core/shared/command.ts`：加 `ReasonCode`，`reason?: ReasonCode`。
- `src/core/game.ts`：`dispatch` 返回 `WithEvents`、加 `applyWithEvents`、`apply` 改包装。（**不动 `game-state.ts`/`fixture.ts`**——GameState 不加字段。）
- **全部 `canX` 文件**（reason 中文→code，逐处映射）：`economy/{develop,recruit,allocate,plunder,scout,campaign,reward,patrol,banquet,trade,move,transport,search,suborn,diplomacy,captive,govern}.ts`、`world/succession.ts`、`turn/end-month.ts`、`military/battle-core.ts`、`game.ts`（endMonth 三处）。
- **producers → 返回 `WithEvents`**：`economy/{develop,govern,patrol,plunder,search,transport,suborn,diplomacy}.ts`、`world/disaster.ts`、`military/aftermath.ts`、`world/succession.ts`。
- **orchestrators → 折叠 + 返回 `WithEvents`**：`turn/end-month.ts`（endMonth/resumeMonth/chooseSuccessor/chooseDefenders/advanceCampaigns/finishMonthTail）、`turn/pending.ts`（runNonCampaignPending）。纯子步骤经 `lift` 提升。
- 受影响测试：断言 `reason` 处改断 code；直接调用已改签名的 producers/orchestrators 处取 `.state`（经 `apply` 的调用不受影响）；新增事件断言。

## 任务清单

- [x] 基建：`ReasonCode` + `OutcomeEvent` + `WithEvents`/`withEvents`/`step`/`lift` + `applyWithEvents`/`apply` 包装（事件**并列**返回、**不进** `GameState`；确定性回归测试绿）。
- [x] reason 全树中文→code（含 battle-core/succession/end-month），改相关测试断言。
- [x] 即时经营事件：develop/govern/patrol。
- [x] 月末经营事件：search/plunder/transport/suborn。
- [x] 外交事件：entice/alienate/instigate(+lord-instigated)/induce(+lord-surrendered)。
- [x] 系统事件：disaster（生成/恢复）、succession（stricken/pending/succeeded/eliminated）。

## TDD：是

## 风险 / 待定

- **`ReasonCode` 全集**：现有约 60 处 reason 去重后约 25 个 code，落地时逐处映射；命名以语义为准、跨命令复用。
- **改动放大（已知且机械）**：事件路径上的 producers/orchestrators 签名改 `WithEvents`，连带其**直接调用**的测试（develop/search/end-month/pending 等约 15 个测试文件）要取 `.state`。换来的是 GameState 零新增字段、事件与持久态彻底分离——经评估认为这层分离值得。经 `apply` 的测试与确定性回归不受影响。
- **per-unit 战后明细事件**（占城 city-captured / 俘虏 / 战死 / 逃跑）与**战斗逐日提示**不在本切片（PRD 已划出）；留待战斗 UI 切片，届时在 `military/aftermath`/`battle-core` 增 emit。
- **AI 即时作弊效果**（`ai-internal` 直接改状态、不过执行器）天然不产事件——符合"电脑势力通常不展示"，无需特判。
- **`succession-pending` 的 emit 位**：玩家君主遭劫在 `military/aftermath.resolveStrickenLord` 设 `pendingSuccession`，事件就近在该处 emit；`lord-succeeded` 在 `world/succession.promoteLord`（AI 自动 + 玩家 chooseSuccessor 共用）emit。
- **PRD 验收措辞**已在上文「验收口径澄清」收窄为运行时反馈串，避免误含中文注释/领域名。

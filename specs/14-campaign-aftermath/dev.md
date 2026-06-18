# campaign-aftermath 开发文档

## 方案概述

把 `12-battle` 留下的极简 `resolveCampaignOutcome`（移动攻方武将 + 胜则翻城/加粮 + 两方君主自动重选）深化为完整战后处理，并删除已不可达的 `executeCampaign` 速算死代码。三处关键取舍：

- **`military/campaign.ts` 改名 `military/aftermath.ts`**：`executeCampaign` 删后该文件只剩战后处理，名副其实。它编排 6 步流程；唯一调用方是 `battle.concludeBattle`。
- **`resolveCampaignOutcome` 改单结构入参 `CampaignOutcome`**：把胜负/双方君主/目标城/双方参战名单/合并粮草一次性传入（替代位置参数），由 `concludeBattle` 从 `BattleState` 组装。败军逐人命运消耗 RNG（修订确定性红线）。
- **重选君主"统一选、AI 自动 / 玩家暂停"**：候选选择逻辑（`world/succession`）actor-agnostic、AI 与玩家共用；分支（AI 立即 `promoteLord` vs 玩家挂起 `pendingSuccession` 等 UI 选）由 `aftermath` 读 `state.playerLordId` 决定——这是 core actor-agnostic 的**显式游戏规则例外**（同劝降玩家君主免疫先例）。暂停态走 `GameState.pendingSuccession` + 新 action `chooseSuccessor`，与 `activeBattle` 同构（纯同步、无 Promise）。

**无环依赖**：`world/city`（战损）、`world/succession`（候选/换主，actor-agnostic）为纯工具；`military/aftermath` 编排它们 + `world/queries`/`placement`/`item`，读 `playerLordId` 做暂停分支；不 import `turn`。`turn/end-month` import `military`（`concludeBattle`）+ `world/succession`（`promoteLord`），检测 `pendingSuccession` 挂起、`chooseSuccessor` 续跑。

## 接口设计

### world/city.ts（修改·加战损）

```ts
// 战后城市战损（无条件、胜负皆受）：农业/商业/金各 floor(×0.95)、民忠 floor(×0.90)；不碰粮（粮由粮草合并覆盖）。
// 规则身份、内联常量，与 ravage / applyDisasterDamage 同位。
export function applyBattleDamage(c: City): City
```

### world/succession.ts（修改·拆纯工具，actor-agnostic）

```ts
// 候选 = 该势力非俘虏、非君主自身的武将（lordId===lordId && !isCaptive && id!==lordId）。
export function successionCandidates(state: GameState, lordId: OfficerId): Officer[]
// 自动选：候选中有效智力最高（平局 id 字典序最小）；无候选→null。
export function pickSuccessor(state: GameState, lordId: OfficerId): OfficerId | null
// 换主：oldLord 的全部城 + 非俘虏武将 lordId→newLord、newLord 忠诚 100；
// 若 oldLord===state.playerLordId 则一并把 state.playerLordId→newLord。被俘/战死的 oldLord 自身不改（保持俘虏/已删）。
export function promoteLord(state: GameState, oldLordId: OfficerId, newLordId: OfficerId): GameState
// 校验玩家选新君（供 canApply）：pendingSuccession 非空 + officerId ∈ successionCandidates(其 lordId)。
export function canChooseSuccessor(state: GameState, officerId: OfficerId): CommandCheck
```

> 旧 `resolveSuccession` 删除：其"被俘+有城+候选"守卫与 AI 自动路径上移到 `aftermath.resolveStrickenLord`（见下），守卫不再依赖 `isCaptive`（要兼容君主战死被删的情形）。

### military/aftermath.ts（由 campaign.ts 改名·编排 + 败军处理）

```ts
// 战后处理一次性入参（concludeBattle 从 BattleState 组装）。
export interface CampaignOutcome {
  readonly attackerWins: boolean
  readonly attackerLord: OfficerId // 攻方君主；胜利占城翻 city.lordId 用（败方君主无需，遭劫君主从 defeated 派生）
  readonly targetCityId: CityId
  readonly attackerIds: readonly OfficerId[] // 攻方参战武将（concludeBattle 由 units.side 派生）
  readonly defenderIds: readonly OfficerId[] // 守方参战武将（concludeBattle 由 units.side 派生）
  readonly mergedFood: number // 覆盖式粮草合并值 = playerProvisions + opponentProvisions
}

// 完整战后处理（消耗 state.rng）。顺序：
// 1) 胜方存活单位 cityId→目标城；
// 2) attackerWins → 占城（仅 city.lordId=attackerLord）；
// 3) 败军逐人命运（processDefeatedArmy，耗 RNG），收集遭劫君主 id；
// 4) 对每个遭劫君主 resolveStrickenLord（AI 自动换主 / 玩家挂起 pendingSuccession / 灭亡）；
// 5) 目标城 applyBattleDamage；
// 6) 目标城 food=mergedFood（覆盖）。
export function resolveCampaignOutcome(state: GameState, o: CampaignOutcome): GameState

// 败军处理（内部，耗 RNG，按 officerId 字典序）：对每名 loser 逐一——
//  ① RandInt(0,99) > 有效智力 → 被俘；
//  ② 否则取 citiesOfLord(其 lordId)（占城后、按 id 排序）随机一座 → 逃跑成功（cityId=该城、保留兵）；
//  ③ 无城 → 逃跑失败：RandInt(0,99)===0 → 战死，否则 → 被俘。
// 被俘：cityId=目标城、troops=0、lordId 不变（派生成俘虏）。
// 战死：道具 discover(holdByCity(item,目标城))、officer 从 officers 删除。
// 返回新 state 与遭劫（被俘∪战死）君主 id 集合（供步骤 4）。
// 内部 helper，不导出（经 resolveCampaignOutcome 测）。

// 遭劫君主处置（内部，读 playerLordId 的显式例外）：
//  无城 或 无候选 → 灭亡（原样返回）；
//  lordId===playerLordId → 设 state.pendingSuccession={lordId}（挂起，不换主）；
//  否则（AI）→ promoteLord(state, lordId, pickSuccessor(state,lordId)!)。
// 内部 helper。
```

### game-state.ts（修改）

```ts
export interface GameState {
  // …既有字段…
  // 非空=月末挂起在「待玩家选新君」；resumeMonth 检测后提前返回、由 chooseSuccessor 兑现续跑。普通态恒为 null。
  readonly pendingSuccession: { readonly lordId: OfficerId } | null
}
```

### military/battle.ts（修改·concludeBattle 组装结构）

```ts
// 写回每单位 troops/experience/level 后，从 BattleState 组装 CampaignOutcome：
//  attackerWins = mode==='attack' ? outcome==='playerWin' : outcome==='playerLose'
//  attackerIds/defenderIds = units 中 side===攻/守方 的 officerId（均派生，BattleState 不再存名单）
//  attackerLord = 任一攻方单位对应 Officer.lordId（整场不变，BattleState 不再存）
//  mergedFood = playerProvisions + opponentProvisions
// 调 resolveCampaignOutcome(withTroops, outcome)；清空 activeBattle。签名不变。
export function concludeBattle(state: GameState): GameState
```

### turn/end-month.ts（修改·删速算 + 挂起/续跑）

```ts
// endMonth：开头 guard 改为 if (state.activeBattle || state.pendingSuccession) return state。
//   advanceCampaigns 删除「非玩家 campaign 速算 fallback」分支（AI 不出征、不可达）：
//   首个 campaign 必玩家参与 → 挂起 activeBattle；无 campaign → 尾段。
export function endMonth(state: GameState, config: GameConfig): GameState

// resumeMonth：concludeBattle 写回（含完整战后处理）→ dropFirstCampaign →
//   若 pendingSuccession 非空 → 提前返回（挂起，等 chooseSuccessor）；否则 advanceCampaigns。
export function resumeMonth(state: GameState, config: GameConfig): GameState

// 新增：玩家选定新君后兑现并续跑月末。
//   promoteLord(state, pendingSuccession.lordId, officerId) → 清空 pendingSuccession → advanceCampaigns。
//   非法（canChooseSuccessor 不过）→ no-op。
export function chooseSuccessor(
  state: GameState,
  officerId: OfficerId,
  config: GameConfig
): GameState
```

### game.ts（修改）

```ts
export type Action =
  | /* …既有… */
  | { type: 'chooseSuccessor'; officerId: OfficerId }   // 玩家君主遭劫后手动立新君（续跑月末）
// canApply：'chooseSuccessor'→canChooseSuccessor；'endMonth' 在 activeBattle 或 pendingSuccession 非空时 {ok:false}。
// apply：'chooseSuccessor'→chooseSuccessor(state, officerId, config)。
```

## 模块职责

- `world/city.ts`：加 `applyBattleDamage`（战损纯变换，与 `ravage`/`applyDisasterDamage` 同位收敛）。
- `world/succession.ts`：候选选择/换主的 actor-agnostic 纯工具（`successionCandidates`/`pickSuccessor`/`promoteLord`/`canChooseSuccessor`）；不读 `playerLordId`。删 `resolveSuccession`。
- `military/aftermath.ts`（原 `campaign.ts`）：战后处理编排（6 步）+ 败军逐人命运（`processDefeatedArmy`）+ 遭劫君主处置（`resolveStrickenLord`，读 `playerLordId` 做暂停分支）。编排 `world/city`/`succession`/`queries`/`placement`/`item`；不 import `turn`。
- `military/battle.ts`：`concludeBattle` 从 `BattleState` 组装 `CampaignOutcome`（签名不变）。
- `turn/end-month.ts`：删速算 fallback；`resumeMonth` 检测 `pendingSuccession` 挂起；新增 `chooseSuccessor` 续跑。
- `game.ts`/`game-state.ts`：接 `chooseSuccessor` action + `pendingSuccession` 字段；`endMonth` 守卫挂起态。

## 要测的行为

- [x] `applyBattleDamage`：农/商/金 `floor(×0.95)`、民忠 `floor(×0.90)`、food 不变。
- [x] `successionCandidates`/`pickSuccessor`：排除俘虏与君主自身；有效智力最高、平局 id 最小；空候选→null。
- [x] `promoteLord`：oldLord 的城+非俘虏武将归属→newLord、newLord 忠诚 100；oldLord===playerLordId 时 playerLordId→newLord；被俘/已删的 oldLord 自身不被改。
- [x] 胜方回城：胜方全部参战单位（含 0 兵未战死者）cityId→目标城。
- [x] 占城在败军处理之前：攻方胜则 city.lordId=攻方；败方逃跑只落其势力**其余存活城**；占下最后一城 → 该方无城可逃 → 逃跑必失败。
- [x] 败军第一关：`RandInt(0,99) > 有效智力` → 被俘（cityId=目标城、兵清零、lordId 不变）。
- [x] 败军逃跑：有城则随机落一座（保留兵）；多城时按 id 排序 + RandInt 选择可复现。
- [x] 败军逃跑失败：无城时 `RandInt(0,99)===0` 战死、否则被俘；战死→道具入目标城且 discovered=true、officer 删除。
- [x] 遭劫君主（被俘∪战死）：有城+有候选时——AI 自动换主（智力最高、忠诚 100、势力城+武将归新君）；玩家则设 `pendingSuccession` 且**不**换主、不 Game Over。
- [x] 遭劫君主无候选或无城 → 灭亡（不立新君、剩余皆俘虏）；君主战死被删也能触发立新君（不依赖 isCaptive）。
- [x] 城市战损无条件（胜/负、攻/守均扣一次）；粮草合并为覆盖式（目标城 food=双方剩余战场粮之和，非累加）。
- [x] `concludeBattle` 组装 `CampaignOutcome` 正确（attackerWins 由 mode+outcome；攻/守名单由 units.side、attackerLord 由攻方单位 Officer.lordId 派生；mergedFood）。
- [x] 端到端：玩家进攻胜→占城+AI 败军命运+AI 君主重选/灭亡，续跑尾段；玩家进攻败且带君主被俘→`resumeMonth` 挂起 `pendingSuccession`→`chooseSuccessor` 兑现换主（playerLordId 改）→续跑剩余 campaign/尾段。
- [x] `endMonth`/`canApply` 在 `pendingSuccession` 非空时拒绝推进；`chooseSuccessor` 非法 no-op。
- [x] 整局同 seed 可复现（战后处理耗 RNG 但确定）；删 `executeCampaign` 后既有非战斗月行为不回归。

## 新建文件

- 无纯新增源文件（`aftermath.ts` 由 `campaign.ts` 改名而来）。

## 修改文件

- `src/core/military/campaign.ts` → 改名 `src/core/military/aftermath.ts`：删 `executeCampaign`/`defenderTroops`；`resolveCampaignOutcome` 改 `CampaignOutcome` 入参 + 完整 6 步；加 `processDefeatedArmy`/`resolveStrickenLord` 内部 helper。
- `src/core/military/campaign.test.ts` → 改名 `aftermath.test.ts`：覆盖败军三关/占城序/战损/粮草/遭劫君主/灭亡。
- `src/core/world/city.ts`：加 `applyBattleDamage` + 内联战损常量。
- `src/core/world/succession.ts`：拆 `successionCandidates`/`pickSuccessor`/`promoteLord`/`canChooseSuccessor`；删 `resolveSuccession`。
- `src/core/world/succession.test.ts`：改测拆出的纯工具（候选/换主/playerLordId 迁移）。
- `src/core/military/battle.ts`：`concludeBattle` 组装 `CampaignOutcome`；import 从 `./aftermath`。
- `src/core/game-state.ts`：`GameState` 加 `pendingSuccession`。
- `src/core/game.ts`：`Action` 加 `chooseSuccessor`；`apply`/`canApply` 分派；`endMonth` 守卫 `pendingSuccession`。
- `src/core/turn/end-month.ts`：删速算 fallback；`resumeMonth` 挂起；加 `chooseSuccessor`。
- `src/core/world/fixture.ts` + 各 `*.test.ts`：GameState 构造补 `pendingSuccession: null`；`battle.test.ts`/`end-month.test.ts` 适配新战后行为（败方不再一律就地成俘虏）。

## 任务清单

- [x] `world/city.ts` 加 `applyBattleDamage`（红绿）。
- [x] `world/succession.ts` 拆 `successionCandidates`/`pickSuccessor`/`promoteLord`/`canChooseSuccessor`、删 `resolveSuccession`（红绿，含 playerLordId 迁移）。
- [x] `game-state.ts` 加 `pendingSuccession`、fixture/测试构造补 `null`，使编译通过。
- [x] `campaign.ts`→`aftermath.ts` 改名：删速算、`resolveCampaignOutcome` 改结构入参 + `processDefeatedArmy`（败军三关，红绿）。
- [x] `aftermath.ts` 接 `resolveStrickenLord`（AI 自动 / 玩家挂起 / 灭亡）+ 战损 + 粮草合并（红绿）。
- [x] `battle.ts` `concludeBattle` 组装 `CampaignOutcome`（红绿，端到端胜/败两路）。
- [x] `turn/end-month.ts` 删速算 fallback + `resumeMonth` 挂起 + `chooseSuccessor`（红绿）。
- [x] `game.ts` 接 `chooseSuccessor`、`endMonth` 守卫；`game.test` 端到端（进攻胜/进攻败带君主→挂起→选新君→续跑）。
- [x] 全量回归绿、typecheck 清；AGENTS 红线 + CONTEXT 已在 PRD/收尾同步。

## TDD：是

## 决策升级

- **AGENTS 架构红线（收尾时写入）**：
  - 战后处理收敛 `military/aftermath.resolveCampaignOutcome`（唯一调用方 `concludeBattle`）；`executeCampaign` 速算死代码已删。
  - 确定性红线再收窄：`resolveCampaignOutcome`（败军命运/逃跑选城）也**消耗 `GameState.rng`**。
  - core actor-agnostic 的**新例外**：战后重选君主"玩家手动选 vs AI 自动选"由 `aftermath` 读 `state.playerLordId` 分支（候选/换主工具仍 actor-agnostic）。
  - 玩家决策暂停态模式：`GameState.pendingSuccession`（类比 `activeBattle`）+ action `chooseSuccessor`，`resumeMonth` 挂起、`chooseSuccessor` 续跑；纯同步无 Promise。
  - 占城仍只翻 `city.lordId`（keep 模型）；败方参战武将的差异化命运全部收敛 `processDefeatedArmy`。
- **CONTEXT 术语**：已在 PRD 阶段写入（战后处理/胜方回城/败军处理/被俘·逃跑·战死/占城 keep/遭劫君主/重选君主深化/待选新君/城市战损/粮草合并）。

## 风险 / 待定

- **逃跑/战死掷骰量纲**：取有效智力 + `RandInt(0,99)`、战死 `===0`；与原作源码若有出入，实现期对齐微调（不改模块边界）。
- **暂停期其它指令未在 canApply 全面拦截**：沿用 `activeBattle` 先例（仅 `endMonth`/推进拦截，余靠 UI 不派发）；如需硬拦截留后续。
- **同月多支出征 + 玩家君主被俘**：`chooseSuccessor` 续跑 `advanceCampaigns` 可能再进下一场战斗（再设 `activeBattle`），可重入正确；连锁基于当时状态、沿用既有边界。
- **战死掉落 2 槽道具入城顺序**：按 `itemsOfOfficer`（equipSeq 升序）遍历入城，holder 改城即可，顺序无下游依赖。
- **`pendingSuccession` 进存档**：挂起中存档可恢复，属可接受的状态膨胀（同 `activeBattle`）。

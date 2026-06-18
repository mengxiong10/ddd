# ai-campaign 开发文档

## 方案概述

承接 `ai-military.ts` 的 `roll===7` TODO，让 AI 生成出征命令；并把 `turn.advanceCampaigns` 从「首个 campaign 必玩家进攻→挂起战斗」扩展为**三类分流**。核心是**最大化复用既有机器**：

- **出征命令生成**（`ai-military`）：沿用 `15` 作弊下令口（不走 `canCampaign`、不扣金/体力），仅多一个「批量占人 + 入队 campaign」的口子。
- **AI vs AI / 无守军占城**：不进地图战，新建 `military/quick-battle.ts` 按胜率表掷骰定胜负，**复用现有 `resolveCampaignOutcome`** 做占城/俘虏/逃跑/重选君主/战损/粮草合并。
- **AI 进攻玩家城**：复用 `12-battle` 的 `defend` 模式交互式战斗，但开战前**暂停让玩家选守军**——新增窄暂停态 `GameState.pendingDefense` + action `chooseDefenders`，与 `pendingSuccession` 完全同构（纯同步、无 Promise）。AI 进攻方在战中仍不行动（`endDay` no-op，沿用 `12`）。
- **守军口径统一到 `world/queries.defendingOfficers`**：守军 = 在该城、属本城势力、非俘虏、**且未被派往外出 campaign** 的武将。出征在外者 `cityId` 仍滞留源城直到战斗结算，必须显式排除；其余 busy（本月被即时/返回类命令占用）仍算守军（月末回防）。`initBattle` 自动选守与「无守军」判定共用此查询，消除三处重复。

关键取舍：

- **AI 选目标的「守军合计」是估算、与 `defendingOfficers` 刻意不同**（PRD 待定已记）：选目标在 `aiTakeTurn`（下令时）跑，用「在任武将兵 + 队列中该城非移动/出征命令执行人兵」估算（不含后备兵）；速算实判在月末用 `defendingOfficers` 兵 + 后备兵。时点/口径不同，各自就近内联，不强行统一。
- **`quick-battle` 与 `aftermath` 分文件**：`quick-battle` 负责「无地图的胜负判定」（替代 `battle` 那半），`aftermath` 负责「战后处理」（已存在、共用）；二者职责正交。
- **无环依赖**：`military/quick-battle` import `military/aftermath` + `world/queries`/`world/city`，不 import `turn`/`ai`；`turn/end-month` import `military`（`quick-battle.quickResolveCampaign` + `battle`）；`ai/*` 单向依赖 economy/world/shared。

## 接口设计

只写签名，不写实现体。

### `world/queries.ts`（新增守军查询，收敛三处重复）

```ts
// 城防守军：cityId 在本城、lordId===本城势力、非俘虏，且未被任何待执行 campaign 征调（officerIds 不含之）。
// 出征在外者 cityId 仍滞留源城直到 concludeBattle/quickResolve 改写，故需显式排除；
// 其余 busy（即时/返回类命令占用）仍计为守军（月末回防）。
export function defendingOfficers(state: GameState, cityId: CityId): Officer[]
```

### `military/quick-battle.ts`（新建·无地图速算）

```ts
// 进攻方胜率(%)，规则身份内联。A=攻方总兵力 D=守方总兵力 FA/FD=攻/守粮草：
//  A===0 → 0；D===0 → 100；A≥2D → 70；A>D → (FA>FD?60:40)；2A<D → 2；其余(A≤D，含相等) → (FA>FD?30:10)。
export function attackerWinPercent(a: number, d: number, fa: number, fd: number): number

// 速算一条 campaign（消耗 state.rng），组装 CampaignOutcome 交 resolveCampaignOutcome：
//  A=Σ attackerIds 现兵；D=Σ defenderIds 现兵 + 目标城 reserveTroops；FA=provisions；FD=目标城 food；
//  defenderIds 为空 → attackerWins=true（无守军直接占城、不掷骰）；
//  否则 attackerWins = RandInt(0,99) < attackerWinPercent(A,D,FA,FD)；
//  mergedFood=provisions+目标城 food；attackerLord=officers[attackerIds[0]].lordId。
export function quickResolveCampaign(
  state: GameState,
  attackerIds: readonly OfficerId[],
  defenderIds: readonly OfficerId[],
  targetCityId: CityId,
  provisions: number
): GameState
```

### `military/battle.ts`（修改·initBattle 接显式守军）

```ts
// 新增可选 explicitDefenderIds：玩家防守时由 chooseDefenders 传入已选名单（已是子集）；
// 省略时（玩家进攻 AI 城）自动取 defendingOfficers(target)。两路均按「太守领衔 + 兵力降序(平局 id 升序)」排序、限 10。
export function initBattle(
  state: GameState,
  officerIds: readonly OfficerId[],
  targetCityId: CityId,
  provisions: number,
  explicitDefenderIds?: readonly OfficerId[]
): BattleState
```

### `game-state.ts`（修改·新增窄暂停态）

```ts
export interface GameState {
  // …既有字段…
  // 非空=月末挂起在「AI 进攻玩家城、待玩家选守军」；endMonth/resumeMonth 拒推进，
  // 由 chooseDefenders 兑现（开战或弃守占城）后清空。普通态恒为 null。类比 pendingSuccession。
  readonly pendingDefense: { readonly targetCityId: CityId } | null
}
```

### `turn/end-month.ts`（修改·三类分流 + 防守开战）

```ts
// 守卫追加 pendingDefense：if (activeBattle || pendingSuccession || pendingDefense) return state。
export function endMonth(state: GameState, config: GameConfig): GameState

// advanceCampaigns（私有）三类分流——找首个 campaign c（无→尾段），算 defenders=defendingOfficers(target)、
// attackerLord=officers[c.officerIds[0]].lordId、defenderLord=cities[target].lordId：
//  ① defenders 空 → quickResolveCampaign(空守军直接占城) → dropFirstCampaign → 递归；
//  ② attackerLord===playerLordId → 玩家进攻：startDay(initBattle 挂起)（现有）；
//  ③ defenderLord===playerLordId → 玩家防守：设 pendingDefense={targetCityId} 返回（暂停）；
//  ④ 其余(AI vs AI) → quickResolveCampaign(掷骰) → dropFirstCampaign → 递归。

// 校验玩家选守军（供 canApply）：pendingDefense 非空 + officerIds 去重 + ⊆ defendingOfficers(target) + 长度≤10。
// 空数组合法（弃守=直接被占）。
export function canChooseDefenders(state: GameState, officerIds: readonly OfficerId[]): CommandCheck

// 玩家选定守军后兑现并续跑（chooseDefenders 委派）：canChooseDefenders 不过→no-op；
//  officerIds 空 → quickResolveCampaign(弃守直接占城) → dropFirstCampaign → 清 pendingDefense → advanceCampaigns；
//  否则 → startDay(initBattle(首 campaign attackerIds/target/provisions, explicitDefenderIds=officerIds)) → 清 pendingDefense。
export function chooseDefenders(
  state: GameState,
  officerIds: readonly OfficerId[],
  config: GameConfig
): GameState
```

### `game.ts`（修改·接 chooseDefenders）

```ts
export type Action =
  | /* …既有… */
  | { type: 'chooseDefenders'; officerIds: readonly OfficerId[] } // AI 进攻玩家城后玩家选守军开战/弃守
// canApply: 'chooseDefenders' → canChooseDefenders；'endMonth' 在 pendingDefense 非空时 {ok:false,'请先选守军迎战'}。
// apply: 'chooseDefenders' → chooseDefenders(state, action.officerIds, config)。
```

### `ai/ai-shared.ts`（新增两个共享助手）

```ts
// 某城的相邻敌城（lordId≠该势力，含玩家城），id 升序。供 internal 移动选城 + military 选目标共用。
export function adjacentEnemyCities(state: GameState, cityId: CityId, lordId: OfficerId): City[]
// AI 批量入队（出征）：对 officerIds 逐一 setBusy + 追加一条 PendingCommand；不扣成本、不动 RNG。
export function busyEnqueueMany(
  state: GameState,
  officerIds: readonly OfficerId[],
  cmd: PendingCommand
): GameState
```

### `ai/ai-military.ts`（实现 roll===7 出征）

```ts
// 军备：选强化对象 → month%3 升级 → 逐人 RandInt(0,8)；仅首位武将(i===0) 的 roll===7 可触发出征尝试。
export function runAiMilitary(state: GameState, cityId: CityId): GameState
```

出征尝试（i===0 ∧ roll===7，**固定判定顺序、消费 rng 仅在 50% 那步**）：

| 序  | 关         | 判据（不过则跳过、不下令）                                                                                    | 耗 RNG |
| --- | ---------- | ------------------------------------------------------------------------------------------------------------- | :----: |
| 1   | 相邻敌城   | `adjacentEnemyCities(src,lord)` 非空                                                                          |   否   |
| 2   | 可出征门槛 | 在任武将按兵力降序：数量 ≥4 **且** 最高兵力 ≥1000                                                             |   否   |
| 3   | 50%        | `RandInt(0,1)===0` 才继续                                                                                     | **是** |
| 4   | 选目标     | 相邻敌城中守军合计最低者（平局 id 最小）；`weakestTarget`                                                     |   否   |
| 5   | 组建+入队  | 名单=兵力降序前 `min(10, 在任数−1)`（留≥1）；provisions=`src.food`、`spendFood` 清零本城粮；`busyEnqueueMany` |   否   |

内部 helper（不导出）：

```ts
// 选目标用「守军合计」估算（≠ defendingOfficers）：本城在任武将兵 + 队列中该城已派出且命令∉{move,campaign}的执行人兵。不含后备兵。
function estimatedGarrison(state: GameState, cityId: CityId): number
// 相邻敌城中 estimatedGarrison 最低者（平局 id 最小）。
function weakestTarget(state: GameState, enemies: readonly City[]): CityId
```

### `ai/ai-internal.ts`（小重构·复用 adjacentEnemyCities）

`hasAdjacentEnemy(state,cityId,lordId)` 改为 `adjacentEnemyCities(state,cityId,lordId).length > 0`；`pickMoveTarget` 行为不变。

## 模块职责

- `world/queries.ts`：加 `defendingOfficers`（守军单一定义，三处共用）。
- `military/quick-battle.ts`（新）：无地图胜负——`attackerWinPercent`（纯）+ `quickResolveCampaign`（耗 RNG，委派 `aftermath`）。不 import turn/ai。
- `military/battle.ts`：`initBattle` 接可选显式守军 + 自动路改用 `defendingOfficers`。
- `military/aftermath.ts`：不变（`resolveCampaignOutcome` 被 battle 与 quick-battle 共同调用）。
- `turn/end-month.ts`：`advanceCampaigns` 三类分流；`chooseDefenders`/`canChooseDefenders` 防守开战；守卫加 `pendingDefense`。
- `game.ts`/`game-state.ts`：接 `chooseDefenders` action + `pendingDefense` 字段。
- `ai/ai-military.ts`：实现出征生成（替换 TODO）。
- `ai/ai-shared.ts`：加 `adjacentEnemyCities` + `busyEnqueueMany`。
- `ai/ai-internal.ts`：复用 `adjacentEnemyCities`（行为不变）。

## 要测的行为

- [ ] `defendingOfficers`：含本城势力非俘虏武将（含本月即时/返回类 busy）；排除俘虏、外势力、**外出 campaign 征调中**的武将。
- [ ] `attackerWinPercent`：A=0→0、D=0→100、A≥2D→70、A>D 看粮 60/40、2A<D→2、A≤D（含相等）看粮 30/10；边界（A=2D、A=D、2A=D）归档正确。
- [ ] `quickResolveCampaign`：defenderIds 空→直接占城（不掷骰、attackerWins）；非空→按胜率掷 `RandInt(0,99)` 定胜负；D 含后备兵；mergedFood=provisions+目标城粮；胜负后复用 `resolveCampaignOutcome`（占城/俘虏/逃跑/重选君主/战损/合并粮），同 seed 可复现。
- [ ] AI 出征生成：仅 i===0 的 roll===7 可触发；无相邻敌城 / 在任<4 / 最高兵力<1000 任一不满足→不下令；过门槛后 50% 决定；目标取估算守军最弱（平局 id 最小）；名单兵力降序 `min(10,在任−1)`、城内留≥1；provisions=本城全部粮且本城粮清零；经 busy+入队，不走 canCampaign、不扣金/体力。
- [ ] 后续武将（i≥1）roll===7 不再出征（每城每月至多一次出征尝试）。
- [ ] `advanceCampaigns` 分流：空守军（攻方 AI/玩家皆然）→直接占城；玩家进攻有守军 AI 城→交互式战斗（现有）；AI 进攻有守军玩家城→设 `pendingDefense` 暂停；AI vs AI 有守军→速算续跑。
- [ ] `pendingDefense`：`endMonth`/`canApply(endMonth)`/`resumeMonth` 在其非空时拒推进；`chooseDefenders` 选≥1→进 `defend` 交互式战斗（攻方 AI 不行动、玩家可歼敌或拖到第 30 天胜）；选 0→弃守直接被占；非法 no-op。
- [ ] 防守战败致玩家君主遭劫仍触发 `pendingSuccession`；AI 君主（速算/防守中）遭劫自动立新君、不暂停。
- [ ] 集成：一月内玩家进攻 + AI 进攻玩家 + AI vs AI 多支 campaign 按队列序正确分流、可重入；同 seed 可复现；玩家不会被自动下出征命令。

## 新建文件

- `src/core/military/quick-battle.ts`：无地图速算（`attackerWinPercent` + `quickResolveCampaign`）。
- `src/core/military/quick-battle.test.ts`：胜率表 + 速算 + 直接占城。

## 修改文件

- `src/core/world/queries.ts`：加 `defendingOfficers`。
- `src/core/military/battle.ts`：`initBattle` 接可选 `explicitDefenderIds`、自动路改用 `defendingOfficers`。
- `src/core/game-state.ts`：`GameState` 加 `pendingDefense`。
- `src/core/game.ts`：`Action` 加 `chooseDefenders`；`apply`/`canApply` 分派；`endMonth` 守卫 `pendingDefense`。
- `src/core/turn/end-month.ts`：`advanceCampaigns` 三类分流；加 `chooseDefenders`/`canChooseDefenders`；守卫加 `pendingDefense`；更新「无非玩家 campaign」旧注释。
- `src/core/ai/ai-military.ts`：实现出征生成（替换 TODO）+ `estimatedGarrison`/`weakestTarget`。
- `src/core/ai/ai-shared.ts`：加 `adjacentEnemyCities` + `busyEnqueueMany`。
- `src/core/ai/ai-internal.ts`：`hasAdjacentEnemy` 复用 `adjacentEnemyCities`。
- `src/core/world/fixture.ts` + 各 `*.test.ts` 的 GameState 构造：补 `pendingDefense: null`。

## 任务清单

- [x] `world/queries.defendingOfficers` + 测（含排除外出 campaign）；`game-state.pendingDefense` 字段 + fixture/测试构造补 `null` 使编译通过。
- [x] `military/quick-battle`：`attackerWinPercent`（红绿胜率表）+ `quickResolveCampaign`（空守军占城 / 掷骰 / 复用 aftermath，红绿）。
- [x] `military/battle.initBattle` 接显式守军 + 自动路改 `defendingOfficers`（红绿，回归现有玩家进攻战斗）。
- [x] `turn/end-month`：`advanceCampaigns` 三类分流 + `chooseDefenders`/`canChooseDefenders` + 守卫（红绿，含 AI vs AI / 空守军 / 玩家防守暂停）。
- [x] `game.ts` 接 `chooseDefenders` + `endMonth` 守卫；`game.test` 端到端（AI 进攻玩家→暂停→选守军→战斗→续跑）。
- [x] `ai/ai-shared` 加 `adjacentEnemyCities`/`busyEnqueueMany`；`ai-internal` 复用（回归绿）。
- [x] `ai/ai-military` 实现出征生成（首位武将门槛/50%/最弱目标/名单/粮草，红绿）+ 确定性测。
- [x] 端到端集成：一月多支 campaign 分流 + 同 seed 可复现 + 玩家不受自动出征；全量回归绿（520 测）、typecheck 清；`AGENTS.md`/`CONTEXT.md` 红线与术语同步、状态置 done。

## TDD：是

游戏核心 `src/core/`，按 CONSTITUTION 默认 TDD，红绿循环驱动上述行为清单。

## 决策升级（收尾写入根文件）

- **AGENTS 架构红线**：
  - AI 出征承接（`16-ai-campaign`）：军备 `roll===7` 仅首位武将触发、过门槛+50% 后向估算守军最弱相邻敌城出征；经 `busyEnqueueMany` 批量占人入队，沿用作弊下令口。
  - 出征三类分流：`advanceCampaigns` 按「目标城有无守军 + 攻/守是否玩家」分流（空守军直接占城 / 玩家进攻交互战 / AI 进攻玩家暂停选守军 / AI vs AI 速算）；修订 `15` 的「无非玩家 campaign」假设。
  - 无地图速算收敛 `military/quick-battle.quickResolveCampaign`，与 `battle` 并列、同走 `aftermath.resolveCampaignOutcome`；消费 `GameState.rng`。
  - 守军单一定义 `world/queries.defendingOfficers`（在城·本势力·非俘虏·非外出 campaign），`initBattle` 自动选守 / 无守军判定 / 速算守方共用。
  - 玩家决策暂停态再添一支 `GameState.pendingDefense`（类比 `pendingSuccession`/`activeBattle`）+ action `chooseDefenders`；`endMonth`/`resumeMonth`/`canApply` 守卫。AI 进攻方在防守战中仍不行动（`12-battle` 对手方 no-op）。
- **CONTEXT 术语**：已在 PRD 阶段写入（AI 出征 / 出征三类分流 / 速算 / 待守军选择）；补 `defendingOfficers`「守军」口径若需要。

## 风险 / 待定

- **AI 出征频率偏低**（首位武将 ∧ roll 命中 ∧ 50% ∧ 多门槛叠加）：先按规格落地，平衡留观察（PRD 待定）。
- **选目标估算 vs 速算实判口径差异**：刻意保留（PRD 待定）；估算不含后备兵、实判含。
- **`initBattle` 自动路改 `defendingOfficers` 微调既有行为**：新排除「外出 campaign 征调中」的武将（修正一城同月既攻又守会重复用人的潜在错误）；其余守军口径不变，回归既有玩家进攻战斗用例。
- **AI 进攻玩家=玩家易胜**：攻方 AI 不行动，玩家拖到第 30 天即胜（`12-battle` 已知局限）；本切片不实现 AI 地图行动。
- **`pendingDefense` 进存档**：挂起中存档可恢复，属可接受状态膨胀（同 `activeBattle`/`pendingSuccession`）。

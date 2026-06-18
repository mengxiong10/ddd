# items（道具系统）开发文档

## 方案概述

三块新东西，都贴既有范式、把改动收敛到少数点：

- **道具归属单一真相源**：新增 `GameState.items`（按 id 索引），每件道具自带判别式 `holder`（属某城 **或** 某武将，二选一）。城/武将的道具列表全用 selector 派生（`itemsInCity`/`itemsOfOfficer`），杜绝双向冗余。
- **有效武力/智力一处收敛**：`queries.effectiveOfficer(state, id)` 返回「force/intel 被所持道具加成覆盖、其余字段不变」的 `Officer`。既有公式（带兵量 `troopCapacity`、开垦/招商增量、掠夺产出、重选君主智力比较）**全部**把输入从 `officer` 换成 `effectiveOfficer(...)` 即自动吃加成——加成逻辑只活在一处，`troopCapacity(o)` 签名零改动。
- **武将忠诚**：`Officer` 加 `loyalty` 字段（与城的 `loyalty` 是不同事实）；`queries.officerLoyalty` 派生——**君主恒 100**（即便经历重选君主也成立），非君主取存储值。赏赐 +8 / 没收 −20 只改非君主存储值并钳制 `[0,100]`。

赏赐/没收是**即时、不占人**指令，与开垦等的下令阶段形态一致，归 `economy/`，经 `game.apply/canApply` 既有分派点接线；**不**入 `pendingCommands`、**不**碰 `Officer.busy`、**不**耗 RNG。两者是镜像对，合在一个文件共享校验助手。

本切片仅 core（项目尚无 store/ui 层，与既有切片一致）；玩家归属校验（`officer.lordId === playerLordId`）与面板展示留待 UI 层落地。

## 接口设计

### shared/ids.ts（修改）

```ts
export type ItemId = string
```

### world/item.ts（新建·聚合 Item + 值对象 ItemHolder）

```ts
// 道具归属（判别式值对象）：属某城 或 某武将，二选一——单一真相源
export type ItemHolder =
  | { readonly kind: 'city'; readonly cityId: CityId }
  | { readonly kind: 'officer'; readonly officerId: OfficerId }

export interface Item {
  readonly id: ItemId
  readonly name: string
  readonly forceBonus: number // 武力加成，≥0
  readonly intelBonus: number // 智力加成，≥0
  readonly holder: ItemHolder
}

// 每名武将最多持有道具数（量纲上限，规则身份，内联常量）
export const MAX_ITEMS_PER_OFFICER = 2

// 归属变更（纯函数，返回新 Item）
export function holdByOfficer(item: Item, officerId: OfficerId): Item
export function holdByCity(item: Item, cityId: CityId): Item
```

### world/officer.ts（修改）

```ts
// 忠诚量纲上限（百分制，规则身份，内联常量）
export const LOYALTY_MAX = 100

export interface Officer {
  // …既有字段…
  readonly loyalty: number // 新增：武将忠诚，取值 [0, LOYALTY_MAX]
}

// 增减忠诚，钳制 [0, LOYALTY_MAX]（不变量）。调用方负责跳过君主。
export function adjustLoyalty(o: Officer, delta: number): Officer
```

### world/queries.ts（修改·派生只读模型）

```ts
// 城/武将各自持有的道具（按 holder 派生，无第二份存储）
export function itemsInCity(state: GameState, cityId: CityId): Item[]
export function itemsOfOfficer(state: GameState, officerId: OfficerId): Item[]

// 有效武将：force/intel 叠加所持道具加成之和，其余字段原样
export function effectiveOfficer(state: GameState, officerId: OfficerId): Officer

// 武将忠诚（派生）：君主（officer.lordId===officer.id）恒 LOYALTY_MAX，否则取存储值
export function officerLoyalty(state: GameState, officerId: OfficerId): number
```

### game-state.ts（修改）

```ts
export interface GameState {
  // …既有字段…
  readonly items: Readonly<Record<ItemId, Item>> // 新增：全部道具，按 id 索引
}
// PendingCommand 并集不变——赏赐/没收即时，不入队
```

### economy/reward.ts（新建·赏赐 + 没收，镜像对同文件）

```ts
// 忠诚增减幅度（规则身份，内联常量）
const REWARD_LOYALTY_GAIN = 8
const CONFISCATE_LOYALTY_LOSS = 20

// 赏赐：把作用城(=officer.cityId)所属的道具 itemId 转给该城非俘虏武将 officerId。
// 校验：武将存在且非俘虏；道具存在且 holder 为该城；该武将道具数 < MAX_ITEMS_PER_OFFICER。
// 不校验 busy（君主命令，武将本月仍可做其他事）。
export function canReward(state: GameState, officerId: OfficerId, itemId: ItemId): CommandCheck
// 变更：道具 holder→该武将；非君主则忠诚 +REWARD_LOYALTY_GAIN（封顶）。即时、不占人、不耗 RNG；非法 no-op。
export function reward(state: GameState, officerId: OfficerId, itemId: ItemId): GameState

// 没收：把武将 officerId 所持道具 itemId 收回其所在城。
// 校验：武将存在且非俘虏；道具存在且 holder 为该武将。
export function canConfiscate(state: GameState, officerId: OfficerId, itemId: ItemId): CommandCheck
// 变更：道具 holder→officer.cityId；非君主则忠诚 −CONFISCATE_LOYALTY_LOSS（下限 0）。即时、不占人、不耗 RNG；非法 no-op。
export function confiscate(state: GameState, officerId: OfficerId, itemId: ItemId): GameState
```

### game.ts（修改）

```ts
export type Action =
  | /* …既有… */
  | { type: 'reward'; officerId: OfficerId; itemId: ItemId }       // 赏赐（不占人，即时）
  | { type: 'confiscate'; officerId: OfficerId; itemId: ItemId }   // 没收（不占人，即时）
// canApply/apply 各加两分支，委派 canReward/reward、canConfiscate/confiscate
```

## 模块职责

- `world/item.ts`：道具聚合 + `ItemHolder` 判别式值对象 + 归属变更纯函数；不依赖 state，纯粹的数据与不变量。
- `world/officer.ts`：新增 `loyalty` 字段与 `adjustLoyalty`（钳制 `[0,100]`）；君主豁免由调用方负责，聚合本身不判君主。
- `world/queries.ts`：新增 `itemsInCity`/`itemsOfOfficer`（按 holder 派生）、`effectiveOfficer`（道具加成唯一收敛处）、`officerLoyalty`（君主恒 100 的派生）。
- `economy/reward.ts`：赏赐/没收**下令即结算**（即时、不占人、不入队、不耗 RNG）；依赖 world（item/officer/queries），与其它经营指令形态一致。
- `game.ts`：`Action` 加两条，分派到 reward/confiscate；总入口仍极简、actor-agnostic。
- `world/fixture.ts`：播种初始道具（holder=城）与武将 `loyalty`（君主 100、其余 50）。
- **改吃有效值的既有调用点**（仅把入参 `officer`→`effectiveOfficer(...)`，逻辑不动）：`economy/allocate.ts`（带兵量）、`economy/develop.ts`（开垦/招商增量）、`economy/plunder.ts`（掠夺产出 `智+力`）、`world/succession.ts`（重选君主取智力最高）。

## 要测的行为

- [x] `holdByOfficer`/`holdByCity`：正确改写 `holder` 判别式，其余字段不变。
- [x] `itemsInCity`/`itemsOfOfficer`：按 `holder` 正确归类；同一道具只出现在一处。
- [x] `effectiveOfficer`：force/intel = 基础 + 所持道具加成之和；无道具时原样；level/troops/stamina/busy 等其余字段不被改写。
- [x] `officerLoyalty`：君主返回 100（即使存储值非 100）；非君主返回存储值。
- [x] 有效值贯通：持加成道具的武将——带兵量上限上升（经 `allocate` 可分配上限）、开垦/招商增量按有效智力、掠夺产出按有效（智+力）、重选君主按有效智力择优。
- [x] 赏赐合法：道具 holder→该武将；非君主忠诚 +8（封顶 100）；君主被赏赐则忠诚仍 100、道具照常转移。
- [x] 赏赐非法 no-op：道具不属于作用城 / 该武将道具已满(=2) / 目标为俘虏 / 武将或道具不存在。
- [x] 没收合法：道具 holder→officer.cityId；非君主忠诚 −20（下限 0）；君主被没收则忠诚仍 100、道具照常收回。
- [x] 没收非法 no-op：道具不属于该武将 / 目标为俘虏 / 武将或道具不存在。
- [x] 不占人 & 即时：赏赐/没收后目标 `busy` 不变（busy 武将也能被赏赐/没收）；`pendingCommands` 不变；`rng` 不变。
- [x] `game.canApply/apply` 正确分派 `reward`/`confiscate`。
- [x] `fixture` 播种道具与忠诚后，既有构造与全部既有测试编译通过、不回归。

## 新建文件

- `src/core/world/item.ts`：道具聚合 + `ItemHolder` + 归属变更纯函数。
- `src/core/economy/reward.ts`：赏赐/没收下令即结算（含 `canReward`/`reward`/`canConfiscate`/`confiscate`）。
- 对应 `*.test.ts`（同级）：`world/item.test.ts`、`economy/reward.test.ts`；并在 `world/queries.test.ts`、`world/officer.test.ts` 补测新派生/聚合函数。

## 修改文件

- `src/core/shared/ids.ts`：加 `ItemId`。
- `src/core/world/officer.ts`：`Officer` 加 `loyalty`；加 `LOYALTY_MAX`、`adjustLoyalty`。
- `src/core/world/queries.ts`：加 `itemsInCity`/`itemsOfOfficer`/`effectiveOfficer`/`officerLoyalty`。
- `src/core/game-state.ts`：`GameState` 加 `items`。
- `src/core/game.ts`：`Action` 加 `reward`/`confiscate`；`canApply/apply` 分派。
- `src/core/economy/allocate.ts`、`economy/develop.ts`、`economy/plunder.ts`、`world/succession.ts`：公式输入改用 `effectiveOfficer(state, officerId)`。
- `src/core/world/fixture.ts`：播种 `items`（holder=城）与武将 `loyalty`（君主 100、其余 50）。

## 任务清单

- [x] `shared/ids.ts` 加 `ItemId`；`world/item.ts` 聚合 + `holdByOfficer`/`holdByCity`（红绿）。
- [x] `world/officer.ts` 加 `loyalty` + `adjustLoyalty`/`LOYALTY_MAX`（红绿）；`game-state.ts` 加 `items`；`fixture.ts` 播种道具与忠诚，既有测试与构造编译通过。
- [x] `world/queries.ts` 加 `itemsInCity`/`itemsOfOfficer`/`effectiveOfficer`/`officerLoyalty`（红绿）。
- [x] 把 `allocate`/`develop`/`plunder`/`succession` 的公式输入换成 `effectiveOfficer`（红绿，验证加成贯通且未持道具时不回归）。
- [x] `economy/reward.ts` `canReward`/`reward`（红绿，覆盖合法 + 各非法 no-op + 君主豁免）。
- [x] `economy/reward.ts` `canConfiscate`/`confiscate`（红绿，同上）。
- [x] `game.ts` 接 `reward`/`confiscate` 两分支（红绿）；确认不占人/即时/不入队/不耗 RNG。

## TDD：是

## 风险 / 待定

- **重选君主吃有效智力**（已决策）：赏赐道具可能改变被俘后的继承顺位——可接受，但属"装备影响继承"的隐式联动，留意。
- **store/ui 层尚不存在**：本切片仅 core；玩家归属校验（`officer.lordId === playerLordId`，赏赐/没收只能对己方）与城/武将道具、忠诚的面板展示留待 UI 层落地，与既有 campaign 等切片处理一致。
- **AI 本切片不主动赏赐/没收**（YAGNI）：AI 接入留待后续。
- **`items` 进存档/快照**：`holder` 判别式可序列化，二选一天然保证"不会同时属城与将"。
- **君主存储忠诚值无意义**：派生恒 100 覆盖之；保留存储字段只为统一形状，赏赐/没收对君主跳过写入。

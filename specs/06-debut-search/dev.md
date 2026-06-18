# debut-search 开发文档

## 方案概述

延续既有架构：纯函数 `apply(state, action, config)`、可变态收敛 `GameState`、`can*/X` 分离、占人用 `Officer.busy`、月末顺序唯一归 `turn/end-month`、效果延后指令走 `pendingCommands` 两趟分派、RNG 经 `state.rng` 线性穿过（见 `develop`）。本切片引入两块新东西，互相独立：

- **登场（运行时月末事件）**：未登场武将/道具放 `GameState.pendingDebuts`（独立池），到达登场年后于月末「月份+1」之后登场到某城——`world/debut.ts` 负责选城（未指定则在全部城中随机、消耗 RNG）、物化进 `officers`/`items`、出池；`turn/end-month` 在固定日历末尾调用。
- **搜寻（占人 + 月末执行指令）**：形态完全照搬掠夺——`economy/search.ts` 的 `canSearch`/`search`（扣体力、busy、入队）/`executeSearch`（月末四分支 + 发现判定，消耗 RNG）；`PendingCommand` 加 `search` 分支，`turn/pending` 加一个 case，`game.apply/canApply` 加一个分派。

关键取舍：

- **「无主/在野」只让 `lordId` 可空（活代码必需）；「未登场」只用独立池 + `Omit`（活代码零改动）**：在野武将活在 `officers` 里、确实无主，`lordId: OfficerId | null` 配合 `isCaptive`/`officersInCity` 加 `null` 守卫躲不掉；而未登场实体不进 `officers`/`items`，故池条目用 `Omit<Officer,'cityId'>` / `Omit<Item,'holder'>` 表达「除落城外全量」，**不放宽** `cityId`/`holder` 类型，避免 6–8 处取用点被迫加 `!`（低改动放大）。
- **登场归 `world`、非 `turn`/`economy`**：登场是「创建城内 officer/item、选城」的 world 领域逻辑；`turn/end-month` 只负责在日历正确位置编排调用（与 settle 同构），不含物化规则。
- **搜寻完全复用月末队列基建**：`search` 是非 `campaign` 项，落在 `runPendingCommands` 第一趟，零改动两趟分派结构；新增「月末执行」指令只加一个 type 分支 + 一个 `executeX`。
- **搜寻是首条消耗 RNG 的月末指令**：`executeSearch` 读 `state.rng`、线性推进、写回（同 `develop`）；RNG 调用次序在本文档锁定以保证可复现。
- **`discovered` 是道具新存储事实**：未发现道具对玩家隐藏且不可赏赐——`canReward` 加 `discovered` 校验；fixture 既有道具恒 `discovered:true`。

## 接口设计

> 仅签名，不含实现体。

### game-state.ts（修改：登场池 + 队列加 search）

```ts
/** 待登场池条目（判别式）：除「落城才能定」的字段外存全量。debutYear/targetCityId 为调度元数据。 */
export type DebutEntry =
  | {
      readonly type: 'officer'
      readonly debutYear: number
      readonly targetCityId: CityId | null
      readonly officer: Omit<Officer, 'cityId'>
    } // officer.lordId === null（无主）；recruiterId 已设
  | {
      readonly type: 'item'
      readonly debutYear: number
      readonly targetCityId: CityId | null
      readonly item: Omit<Item, 'holder'>
    } // item.discovered === false；recruiterId 已设

export type PendingCommand =
  | { readonly type: 'plunder'; readonly officerId: OfficerId }
  | { readonly type: 'campaign' /* …既有… */ }
  | { readonly type: 'search'; readonly officerId: OfficerId } // 搜寻：本城=officer.cityId（不另存）

export interface GameState {
  // …既有…
  /** 未登场武将/道具池；到达登场年后于月末登场并出池。 */
  readonly pendingDebuts: readonly DebutEntry[]
}
```

### world/officer.ts（修改：lordId 可空 + 伯乐）

```ts
export interface Officer {
  // …既有…
  readonly lordId: OfficerId | null // null = 无主（覆盖未登场/在野）
  readonly recruiterId: OfficerId | null // 伯乐；null = 无指定
}
```

> `troopCapacity`/`spendStamina`/`setBusy`/`adjustLoyalty` 等签名不变（不吃 lordId）。

### world/item.ts（修改：已发现 + 伯乐 + discover）

```ts
export interface Item {
  // …既有…
  readonly discovered: boolean // fixture 既有恒 true；登场道具落城为 false
  readonly recruiterId: OfficerId | null
}
/** 标记已发现（纯函数）。 */
export function discover(item: Item): Item
```

### world/queries.ts（修改：null 守卫 + 搜寻候选选择器）

```ts
// isCaptive：officer.lordId === null（无主）时返回 false（在野不是俘虏）。
// officersInCity(onlyAvailable)：在任筛选追加 o.lordId !== null（在野不可被指令指派）。
export function isCaptive(state: GameState, officerId: OfficerId): boolean
export function officersInCity(
  state: GameState,
  cityId: CityId,
  opts?: { onlyAvailable?: boolean }
): Officer[]

/** 本城在野武将（lordId === null）：搜寻招募候选。 */
export function wanderingOfficersInCity(state: GameState, cityId: CityId): Officer[]
/** 本城未发现道具（holder=本城 且 !discovered）：搜寻发现候选。 */
export function undiscoveredItemsInCity(state: GameState, cityId: CityId): Item[]
```

### world/debut.ts（新建：月末登场事件）

```ts
/**
 * 月末登场（在 month+1 之后调用）：凡 pendingDebuts 中 state.year >= debutYear 者登场。
 * 落城 = targetCityId ?? 在全部城中随机选一（消耗 RNG）；武将物化进 officers（补 cityId）、
 * 道具物化进 items（补 holder=城），并移出池。按池数组序处理；未到年者留池。turn 层调用，自身是 world 规则。
 */
export function runDebuts(state: GameState): GameState
```

### economy/search.ts（新建：搜寻下令 + 月末执行）

```ts
/** 搜寻规则身份（内联，不入 config）：四分支均分、过筛/招募阈值、忠诚区间、资源量纲上限。 */
// const SEARCH_SIEVE_MAX = 149   // RandInt(0,149) < 有效智力 才继续
// const RECRUIT_ROLL_MAX = 109   // 伯乐=null 时 RandInt(0,109) < 有效智力 才招募成功
// const RECRUIT_LOYALTY_MIN = 70, RECRUIT_LOYALTY_MAX = 99
// const SEARCH_GAIN_MIN = 10, SEARCH_GAIN_INTEL_FACTOR = 2  // 上限 = max(10, 有效智力×2)
// const SEARCH_RESOURCE_CAP = 30000                          // 城金/城粮搜寻所得封顶

/** 校验：武将存在且未占用、体力 ≥ config.searchStaminaCost；不需金钱。 */
export function canSearch(state: GameState, officerId: OfficerId, config: GameConfig): CommandCheck
/** 下令：扣体力、busy、入队 {type:'search',officerId}；不改城、不动 RNG。非法 no-op。 */
export function search(state: GameState, officerId: OfficerId, config: GameConfig): GameState
/** 月末单条执行（turn 分派）：四分支 + 发现判定，消耗并写回 state.rng。 */
export function executeSearch(state: GameState, officerId: OfficerId): GameState
```

**`executeSearch` 锁定的 RNG 调用次序**（本城 = `officer.cityId`，智力 = `effectiveOfficer` 有效智力）：

1. `branch = RandInt(0,3)`：0 无事 / 1 发现 / 2 金 / 3 粮（无事分支仅推进 RNG、不改状态）。
2. 金：`上限=max(10,智力×2)`；`amount=RandInt(10,上限)`；`城金=min(城金+amount, 30000)`。粮同理作用城粮。
3. 发现：`sieve=RandInt(0,149)`；`sieve ≥ 智力` → 无事收手。否则 `kind=RandInt(0,1)`（0 武将 / 1 道具）。
   - 武将：候选 = `wanderingOfficersInCity`；空 → 无事（不改找道具）。`pick=RandInt(0,len-1)` 选中。读其 `recruiterId`：=本执行人→必成（不掷骰）；=null→`RandInt(0,109)<智力` 才成；=他人→必败（不掷骰）。成功：该武将 `lordId=执行人.lordId`、`loyalty=RandInt(70,99)`（cityId/troops 不变）。
   - 道具：候选 = `undiscoveredItemsInCity`；空 → 无事（不改找武将）。`pick=RandInt(0,len-1)` 选中。`recruiterId` 为 null 或 =执行人 → `discover`；否则失败。

### shared/config.ts（修改：搜寻扁平成本）

```ts
export interface GameConfig {
  // …既有…
  readonly searchStaminaCost: number // 8（搜寻扣体力，门槛同值）
}
// DEFAULT_CONFIG.searchStaminaCost = 8
```

### turn/pending.ts（修改：加 search 分派）

```ts
// 第一趟（非 campaign）新增：case 'search' → executeSearch(next, cmd.officerId)
```

### turn/end-month.ts（修改：月份+1 后调用登场）

```ts
// 新顺序：aiTakeTurn → runPendingCommands → settle → 回城+体力恢复 → 月份+1 → runDebuts
export function endMonth(state: GameState, config: GameConfig): GameState
```

### economy/reward.ts（修改：未发现道具不可赏赐）

```ts
// canReward 追加：item.discovered === false → { ok:false, reason:'道具未被发现' }
```

### game.ts（修改：加 search Action）

```ts
export type Action =
  | /* …既有… */
  | { type: 'search'; officerId: OfficerId } // 搜寻（占人，月末执行）
// canApply/apply 各加 search → canSearch/search 分派。
```

### world/fixture.ts（修改：播种登场池 + 既有实体补字段）

- 既有武将补 `recruiterId: null`（`lordId` 保持非空）。
- 既有道具补 `discovered: true`、`recruiterId: null`。
- 新增 `DEBUT_SEEDS`（若干未登场武将/道具：带 `debutYear`、`targetCityId|null`、伯乐），构造 `pendingDebuts`。
- `createInitialState` 初始化 `pendingDebuts`。

## 模块职责

- `game-state.ts`：根状态 + `DebutEntry`/`PendingCommand` 形状。只定义形状，不含逻辑。
- `world/officer.ts`：`lordId` 可空 + `recruiterId`。聚合纯函数签名不变。
- `world/item.ts`：`discovered`/`recruiterId` + `discover`。
- `world/queries.ts`：在野/俘虏/在任的 `null` 守卫；搜寻两类候选选择器（派生，无第二份存储）。
- `world/debut.ts`：登场事件——选城（随机消耗 RNG）+ 物化 + 出池。world 领域规则。
- `economy/search.ts`：搜寻三件套；四分支与发现判定的规则系数内联于此。
- `shared/config.ts`：新增 `searchStaminaCost`（扁平成本）。
- `turn/pending.ts`：队列加 `search` 分派（编排，不含规则）。
- `turn/end-month.ts`：月末顺序唯一归处，末尾插入 `runDebuts`。
- `economy/reward.ts`：赏赐校验加 `discovered` 门槛。
- `game.ts`：新增 `search` Action 的校验/变更分派。
- `world/fixture.ts`：播种登场池与既有实体新字段。
- 依赖方向：`economy/search → {world, shared}`；`world/debut → {world, shared}`；`turn/{pending,end-month} → {economy, world}`；`game → economy`。无新增循环。

## 要测的行为

- [ ] `isCaptive`：在野武将（`lordId=null`）返回 false；既有俘虏判定不回归。
- [ ] `officersInCity(onlyAvailable)`：排除在野武将；既有「排除 busy/俘虏」不回归。
- [ ] `wanderingOfficersInCity` / `undiscoveredItemsInCity`：只返回本城在野武将 / 未发现道具。
- [ ] `runDebuts`：`year ≥ debutYear` 者登场——指定城落指定城、未指定落随机城（消耗 RNG、可复现）；武将进 `officers`（`lordId=null`、cityId=落城、troops=0）、道具进 `items`（holder=城、`discovered=false`）；出池；未到年者留池、不动 RNG。
- [ ] 月末顺序：登场在「月份+1」之后——`debutYear` 当年的实体在跨入该年的那次 `endMonth` 后出现。
- [ ] `canSearch` 拒绝：武将不存在 / busy / 体力 < `searchStaminaCost`。
- [ ] `search`：扣体力 8、busy=true、入队 `{type:'search',officerId}`；城/RNG 不变；非法 no-op。
- [ ] `executeSearch` 金/粮分支：`amount=RandInt(10,max(10,智力×2))`，城金/城粮 += 且各封顶 30000。
- [ ] `executeSearch` 无事分支 & 过筛失败：除 RNG 外状态不变。
- [ ] 招募判定：伯乐=执行人必成；伯乐=null 看 `RandInt(0,109)<智力`；伯乐=他人必败。成功后该武将 `lordId=执行人君主`、`loyalty∈[70,99]`、cityId/troops 不变。
- [ ] 道具发现：伯乐=null 或执行人成功（`discovered=true`）、他人失败；候选为空当作无事（不改找另一类）。
- [ ] 同城多搜寻按入队序结算：候选随结算更新，已招募武将/已发现道具不被后续搜寻重复获得。
- [ ] `canReward`：道具 `discovered=false` 时拒绝；既有赏赐路径（discovered 道具）不回归。
- [ ] 占人月末回城：搜寻执行人经 `endMonth` 后 busy=false。
- [ ] 既有 `develop/recruit/allocate/plunder/scout/campaign/settle/endMonth` 不回归（新字段默认值无副作用）。

## 新建文件

- `src/core/world/debut.ts`：登场事件领域服务（`runDebuts`）。
- `src/core/economy/search.ts`：搜寻领域服务（`canSearch`/`search`/`executeSearch`）。
- `src/core/world/debut.test.ts`、`src/core/economy/search.test.ts`。

## 修改文件

- `src/core/game-state.ts`：加 `DebutEntry`、`pendingDebuts`，`PendingCommand` 加 `search`。
- `src/core/world/officer.ts`：`lordId` 可空 + `recruiterId`。
- `src/core/world/item.ts`：`discovered`/`recruiterId` + `discover`。
- `src/core/world/queries.ts`：`null` 守卫 + 两个候选选择器。
- `src/core/shared/config.ts`：加 `searchStaminaCost` + 默认值。
- `src/core/turn/pending.ts`：加 `search` 分派。
- `src/core/turn/end-month.ts`：末尾插入 `runDebuts`。
- `src/core/economy/reward.ts`：`canReward` 加 `discovered` 校验。
- `src/core/game.ts`：`Action` 加 `search` + 分派。
- `src/core/world/fixture.ts`：既有实体补字段、播种 `pendingDebuts`、初始化字段。

## 任务清单

> 纵切、每条端到端可验证，先让既有测试保持绿。

- [x] 模型扩字段：`officer.lordId` 可空 + `recruiterId`；`item.discovered`/`recruiterId` + `discover`；fixture 既有实体补 `recruiterId:null`/`discovered:true`，初始化 `pendingDebuts`（确保既有测试全绿）。
- [x] queries：`isCaptive`/`officersInCity` 加 `null` 守卫 + `wanderingOfficersInCity`/`undiscoveredItemsInCity`（红绿）。
- [x] 登场：`DebutEntry`/`pendingDebuts` + `world/debut.runDebuts` + `end-month` 末尾接线 + fixture 播种登场 seeds（红绿：指定/随机落城、出池、时机）。
- [x] 搜寻下令：`config.searchStaminaCost` + `economy/search.canSearch/search` + `PendingCommand.search` + `turn/pending` 分派 + `game` Action（红绿：扣体力/busy/入队/no-op）。
- [x] 搜寻执行：`executeSearch` 四分支 + 发现判定（锁定 RNG 次序）（红绿：金/粮封顶、过筛、招募三态、道具发现、候选空、已招募退出候选）。
- [x] 赏赐门槛：`canReward` 加 `discovered`；端到端测试（apply 搜寻→月末执行→回城）。

## TDD：是

core 全程红绿循环（CONSTITUTION 默认）；UI/store/AI 不在本切片（AI 仍为空步，不主动搜寻）。

## 质量自检

- 接口最小自解释：`can*/*/executeX` 沿用既有约定；`runDebuts`/`discover`/两个选择器各单一职责。✅
- 模块深、职责单一：登场归 `world/debut`、搜寻归 `economy/search`、分派归 `turn/pending`；无 god 模块。✅
- 低改动放大：`search` 复用月末队列基建（加一 type 分支 + 一 `executeX`）；登场为独立池 + 一个日历步骤；`cityId/holder` 不放宽，活代码零改动。✅
- YAGNI：`DebutEntry` 判别式只因「武将+道具」两类真实存在；不为单类提前抽象；AI 搜寻留空步不预实现。✅
- 数据模型无冗余：未登场只存独立池（不进 officers/items）；在野/俘虏/已发现均由 `lordId`/`discovered` 派生或单存；候选为选择器派生。✅
- 复用既有：占人/回城用 `busy`+`endMonth`；扣体力/加金加粮用 officer/city 既有聚合；RNG 穿透同 `develop`。✅
- 测行为非实现：清单针对状态迁移、公式结果与边界（封顶、过筛、招募三态、候选空、顺序）。✅
- 依赖方向健康：economy/world→shared、turn→economy/world、game→economy，无循环；不涉 UI。✅

## 决策升级

- **架构红线（升级 `AGENTS.md`）**：
  - 月末固定顺序扩展为 `pendingCommands → settle → 回城+体力恢复 → 月份+1 → 登场`；登场在「月份+1」之后、按新年份判定。
  - `Officer.lordId` 可空，`null`=无主（统一覆盖未登场/在野）；在野武将不进在任、不参与守城、不被指派、非俘虏，仅可经搜寻招募。
  - 未登场实体存 `GameState.pendingDebuts`（独立池、不进 `officers`/`items`），登场为运行时事件；池条目用 `Omit` 表达「除落城外全量」，不放宽 `cityId`/`holder` 类型。
  - 道具新增 `discovered`：未发现道具不可被赏赐。
- **术语**：登场/登场年/未登场/待登场池/无主·在野/隐匿/已发现·未发现/伯乐/搜寻/发现判定/招募 已于 spec-prd 入 `CONTEXT.md`。

## 风险 / 待定

- 随机落城用 `Object.keys(state.cities)` 的插入序 + `RandInt(0,len-1)`，确定性依赖 key 序稳定（fixture 按 `CITY_SEEDS` 序插入，稳定）。
- `30000` 城金/城粮上限目前仅搜寻所得处强制（收税/收粮仍不封顶）——属搜寻规则身份，置 `search.ts`；若日后做全局资源上限再上提。
- AI 不会主动搜寻（`aiTakeTurn` 仍空步）；占据该城的 AI 可搜寻是规则上的允许，行为留 AI 切片。
- 在野武将的 `stamina/level/force` 等在招募前无意义（fixture 给占位 mock 值）；招募只改 `lordId`/`loyalty`。

# diplomacy 开发文档

## 方案概述

延续既有架构与招降（`08` `economy/suborn.ts`）的同构形态：占人用 `Officer.busy`、效果延后入 `pendingCommands` 两趟分派、RNG 经 `state.rng` 线性穿过、月末顺序唯一归 `turn/end-month`、`canX`/`X`/`executeX` 三段、core actor-agnostic（归属留 store）。本切片四条**经营·外交指令**全部 `占人 ✓ · 效果=月末`：

- **共享判定机器**：招揽 / 离间 / 策反走**同一套三关**（智力差 → 忠诚 → 性格），仅「智力安全线 / 性格系数表 / 成功效果」不同 → 抽一个内部 helper `runThreeGates`，避免三份复制。劝降另起一套关（**城池压制 + 智力差 + 君主性格**，无忠诚关），单独写在 `executeInduce` 内。
- **单文件**：四组 `canX`/`X`/`executeX` + 四张性格系数表 + 共享 helper 收敛于新建 `economy/diplomacy.ts`（外交规则集中一处、低改动放大）。
- **新增派生查询 `governorOf`（太守）**：放 `world/queries.ts`，零存储字段。仅服务策反目标判定。
- **territorial 改写就近留 economy**：招揽迁城 / 策反自立 / 劝降吸收都改 `lordId`（及 `cityId`），沿用 `executeSuborn`/`executeSearch` 在 economy 内改归属的先例，读用 `world/queries`（`governorOf`/`citiesOfLord`/`isCaptive`/`effectiveOfficer`），**不**触 `military`/`world/succession`。因「君主即太守、君主不可策反」，分裂城永不含原君主 → **策反不触发重选君主**，无须接 succession。

关键取舍：

- **劝降「玩家君主免疫」是 core 游戏规则、显式读 `state.playerLordId`**——这是 core 一般 actor-agnostic 的**显式例外**（非归属校验，而是"玩家君主不可被劝降"的规则身份），写在 `executeInduce` 内、无 RNG。升级为架构红线（见决策升级）。
- **招揽/离间/策反目标忠诚读 raw `officer.loyalty`**：目标恒为非君主（raw === 派生），与 `executeSuborn` 一致。
- **招揽/离间共享 `canX` 前置**（敌方在任非君主武将 + 体力 + 城金，仅成本旋钮键不同）抽内部 `canDiplomacyOnEnemyOfficer`；策反在其上加「目标 = 其城太守且非君主」；劝降另写（目标=敌君主 + 城池压制）。
- **目标用 `targetOfficerId`**（敌方武将/太守/君主统一为 officer），类比招降 `captiveId`、侦察 `targetCityId`。`PendingCommand`/`Action` 四个分支同形（`officerId` + `targetOfficerId`），按既有「一 type 一分支」惯例分列、不合并判别式。

## 接口设计

> 仅签名，不含实现体。

### world/queries.ts（修改：新增太守派生）

```ts
/**
 * 太守（派生，零存储字段）：
 * - 该城归属君主（id===city.lordId 的武将）正驻本城（其 cityId===本城）→ 返该君主。
 * - 否则 → 本城在任（lordId===city.lordId 且非俘虏）武将中有效智力最高者（平局取 id 字典序最小）。
 * - 空城 / 仅俘虏 → null。
 * 仅服务策反目标判定；智力取 effectiveOfficer 有效值。
 */
export function governorOf(state: GameState, cityId: CityId): Officer | null
```

> 既有选择器（`isCaptive`/`officersInCity`/`captivesInCity`/`citiesOfLord`/`effectiveOfficer`/`officerLoyalty`）签名不变。

### game-state.ts（修改：队列加四分支）

```ts
export type PendingCommand =
  | /* …既有：plunder | campaign | move | transport | search | suborn… */
  | { readonly type: 'entice'; readonly officerId: OfficerId; readonly targetOfficerId: OfficerId }
  | { readonly type: 'alienate'; readonly officerId: OfficerId; readonly targetOfficerId: OfficerId }
  | { readonly type: 'instigate'; readonly officerId: OfficerId; readonly targetOfficerId: OfficerId }
  | { readonly type: 'induce'; readonly officerId: OfficerId; readonly targetOfficerId: OfficerId }
```

### economy/diplomacy.ts（新建：四指令下令 + 月末执行）

```ts
/** 外交规则身份（内联常量，不入 config）。 */
// const ROLL_MAX = 99                       // 各关掷骰量纲 RandInt(0,99)
// const INTEL_SAFETY = 50                   // 离间/策反/劝降智力差安全线（招揽无安全线，=0）
// const ENTICE_COEFF    = [5, 20, 30, 40, 15] as const  // 招揽性格系数（普通武将表 0..4）
// const ALIENATE_COEFF  = [5, 30, 40, 30, 50] as const  // 离间
// const INSTIGATE_COEFF = [5, 60, 20, 10, 30] as const  // 策反
// const INDUCE_COEFF    = [15, 5, 20, 1, 10]  as const  // 劝降（君主表 0..4：和平/大义/奸诈/狂人/冒进）
// const ENTICE_OK_LOYALTY_MIN = 40, ENTICE_OK_LOYALTY_MAX = 79 // 招揽成功后忠诚 RandInt(40,79)
// const ALIENATE_LOYALTY_DROP = 4           // 离间成功忠诚 −4（下限 0）
// const INDUCE_CITY_RATIO = 2               // 劝降城池压制倍数：执行人君主城数 ≥ 目标君主城数 ×2

/**
 * 三关（智力差→忠诚→性格）按序消费 RNG，返回是否全过 + 推进后 rng。招揽/离间/策反共用。
 * 智力取 effectiveOfficer 有效值；忠诚读 target.loyalty raw（目标恒非君主）。
 * intelSafety：招揽 0、离间/策反 50。coeff：各指令性格系数表（性格关 RandInt<coeff[性格] 通过）。
 */
// function runThreeGates(state: GameState, execId, targetId, intelSafety: number, coeff: readonly number[]): readonly [passed: boolean, next: Rng]

/** 招揽/离间共享前置：执行人在任（存在/未占用/非俘虏）；体力≥staminaCost；本城金≥goldCost；目标为敌方在任非君主武将。 */
// function canDiplomacyOnEnemyOfficer(state, officerId, targetOfficerId, staminaCost, goldCost): CommandCheck

// —— 招揽（Entice）——
export function canEntice(
  state: GameState,
  officerId: OfficerId,
  targetOfficerId: OfficerId,
  config: GameConfig
): CommandCheck
/** 下令：扣体力 enticeStaminaCost、扣本城金 enticeGoldCost、busy、入队 {entice}；不动 RNG。非法 no-op。 */
export function entice(
  state: GameState,
  officerId: OfficerId,
  targetOfficerId: OfficerId,
  config: GameConfig
): GameState
/** 月末执行：三关(安全线0, ENTICE_COEFF)；成功则目标迁入执行人城、lordId=执行人君主、忠诚=RandInt(40,79)。守卫失效 no-op。 */
export function executeEntice(
  state: GameState,
  officerId: OfficerId,
  targetOfficerId: OfficerId
): GameState

// —— 离间（Alienate）——
export function canAlienate(
  state: GameState,
  officerId: OfficerId,
  targetOfficerId: OfficerId,
  config: GameConfig
): CommandCheck
export function alienate(
  state: GameState,
  officerId: OfficerId,
  targetOfficerId: OfficerId,
  config: GameConfig
): GameState
/** 月末执行：三关(安全线50, ALIENATE_COEFF)；成功仅 目标忠诚 −4（下限0）、无成功 RNG。 */
export function executeAlienate(
  state: GameState,
  officerId: OfficerId,
  targetOfficerId: OfficerId
): GameState

// —— 策反（Instigate）——
/** 前置：执行人在任 + 成本；目标须为其所在城 governorOf 且非君主、敌方、非俘虏（君主即太守 → 不可策反）。 */
export function canInstigate(
  state: GameState,
  officerId: OfficerId,
  targetOfficerId: OfficerId,
  config: GameConfig
): CommandCheck
export function instigate(
  state: GameState,
  officerId: OfficerId,
  targetOfficerId: OfficerId,
  config: GameConfig
): GameState
/** 月末执行：三关(安全线50, INSTIGATE_COEFF)；成功则目标自立(lordId=自身)、其城 lordId=自身、该城原势力武将改归目标。无成功 RNG、不触发重选。守卫失效 no-op。 */
export function executeInstigate(
  state: GameState,
  officerId: OfficerId,
  targetOfficerId: OfficerId
): GameState

// —— 劝降（Induce）——
/** 前置：执行人在任；体力≥induceStaminaCost；本城金≥induceGoldCost；目标为敌方君主；城池压制（执行人君主城数 ≥ 目标君主城数 ×2）。 */
export function canInduce(
  state: GameState,
  officerId: OfficerId,
  targetOfficerId: OfficerId,
  config: GameConfig
): CommandCheck
export function induce(
  state: GameState,
  officerId: OfficerId,
  targetOfficerId: OfficerId,
  config: GameConfig
): GameState
/** 月末执行：①目标=玩家君主直接失败 ②城池压制重校 ③智力差关(安全线50) ④君主性格关(INDUCE_COEFF)；成功吸收全部城与臣属、散落武将转在野。无成功 RNG。守卫失效 no-op。 */
export function executeInduce(
  state: GameState,
  officerId: OfficerId,
  targetOfficerId: OfficerId
): GameState
```

**锁定的 RNG 调用次序**（保可复现）：

- **招揽/离间/策反**（`runThreeGates`）：① `R1=RandInt(0,99)` 智力差关（`R1 > 执行人有效智力 − 目标有效智力 + 安全线` 失败）；② `R2=RandInt(0,99)` 忠诚关（`R2 < 目标忠诚` 失败）；③ `R3=RandInt(0,99)` 性格关（`R3 < coeff[性格]` 通过否则失败）。招揽成功再 `R4=RandInt(40,79)` 写忠诚；离间/策反成功无 RNG。早关失败即止、只消费到该关。
- **劝降**：① 玩家君主免疫（`target.id===state.playerLordId` → 失败，无 RNG）；② 城池压制重校（无 RNG）；③ `R1=RandInt(0,99)` 智力差关（安全线 50）；④ `R2=RandInt(0,99)` 君主性格关（`R2 < INDUCE_COEFF[君主性格]` 通过）。成功无 RNG。

### shared/config.ts（修改：四指令扁平成本，每指令独立旋钮）

```ts
export interface GameConfig {
  // …既有…
  readonly enticeStaminaCost: number // 20    readonly enticeGoldCost: number    // 50
  readonly alienateStaminaCost: number // 20    readonly alienateGoldCost: number  // 50
  readonly instigateStaminaCost: number // 20    readonly instigateGoldCost: number // 50
  readonly induceStaminaCost: number // 10    readonly induceGoldCost: number    // 50
}
// DEFAULT_CONFIG 追加上述 8 项默认值。
```

### turn/pending.ts（修改：第一趟加四分派）

```ts
// 非 campaign 趟新增：
// case 'entice':    next = executeEntice(next, cmd.officerId, cmd.targetOfficerId); break
// case 'alienate':  next = executeAlienate(...); break
// case 'instigate': next = executeInstigate(...); break
// case 'induce':    next = executeInduce(...); break
```

### game.ts（修改：加四个 Action）

```ts
export type Action =
  | /* …既有… */
  | { type: 'entice'; officerId: OfficerId; targetOfficerId: OfficerId }    // 招揽（占人，月末）
  | { type: 'alienate'; officerId: OfficerId; targetOfficerId: OfficerId }  // 离间（占人，月末）
  | { type: 'instigate'; officerId: OfficerId; targetOfficerId: OfficerId } // 策反（占人，月末）
  | { type: 'induce'; officerId: OfficerId; targetOfficerId: OfficerId }    // 劝降（占人，月末）
// canApply/apply 各加四个分派 → canEntice/entice 等。
```

## 模块职责

- `economy/diplomacy.ts`：招揽/离间/策反/劝降四组 `canX`/`X`/`executeX` + 共享 `runThreeGates`/`canDiplomacyOnEnemyOfficer` + 四张性格系数表与外交规则常量。外交规则集中处。
- `world/queries.ts`：新增 `governorOf` 派生（太守）；其余选择器不变。
- `shared/config.ts`：四指令扁平成本旋钮（8 项）。
- `game-state.ts`：`PendingCommand` 加四分支（同形）。
- `turn/pending.ts`：第一趟加四分派（编排，不含规则）。
- `game.ts`：四 Action 校验/变更分派。
- 依赖方向：`economy/diplomacy → {world(queries/officer/city), shared}`；`turn/pending → economy/diplomacy`；`game → economy/diplomacy`。无新增循环；不触 military/succession/UI。

## 要测的行为

- [ ] `governorOf`：君主在城返君主；君主不在城返本城在任武将有效智力最高者（道具加成生效；平局取 id 最小）；空城/仅俘虏返 null；在野/俘虏不入选。
- [ ] `canEntice`/`canAlienate` 拒绝：执行人不存在/占用/俘虏；体力 < 成本；城金 < 成本；目标不存在/在野(null)/己方/俘虏/为君主。
- [ ] `entice`/`alienate` 下令：扣体力/城金、执行人 busy、入对应队列分支；RNG 不变；非法 no-op。
- [ ] `executeEntice` 三关：①`R1 > 执行人有效智力 − 目标有效智力`（**无 +50**）失败；②`R2 < 目标忠诚`失败（忠诚100必败）；③`R3 < ENTICE_COEFF[性格]`通过。成功：目标 cityId=执行人城、lordId=执行人君主、忠诚=RandInt(40,79)、道具随人（holder 不变）。
- [ ] `executeAlienate` 三关同上但安全线 +50、系数 `ALIENATE_COEFF`；成功仅忠诚 −4（下限0）、无成功 RNG；失败不改忠诚。
- [ ] `canInstigate`：目标须为其城 `governorOf` 且非君主、敌方、非俘虏；君主驻该城（太守=君主）时拒绝。
- [ ] `executeInstigate` 三关(安全线50, INSTIGATE_COEFF)；成功：目标 lordId=自身、其城 lordId=自身、该城原势力其余武将 lordId 改归目标；第三方俘虏不动；不触发重选君主。
- [ ] `canInduce`：目标为敌方君主；执行人君主城数 ≥ 目标君主城数 ×2 才可下；否则拒绝。
- [ ] `executeInduce`：①目标=`state.playerLordId` 直接失败（无 RNG）；②城池压制月末重校（已不满足→失败）；③`R1 > 智力差+50`失败；④`R2 < INDUCE_COEFF[君主性格]`通过。成功：目标君主全部城 lordId=执行人君主、城内臣属（含君主本人）归执行人君主、散落（不在其城内）武将 lordId=null（在野）。
- [ ] 四条 `executeX` 守卫：目标在结算前已失效（不存在/已易主/已俘获/已非合法目标）→ 安全 no-op、不动 RNG。
- [ ] `game.apply`/`canApply` 四 Action 正确分派；`endMonth` 月末四条在第一趟（非 campaign）按入队序执行、先于 settle 与回城；执行人经 endMonth 回城（busy=false）。
- [ ] 给定相同种子整段推进可复现；既有指令与循环（含招降/出征/搜寻/登场/灾害）不回归。

## 新建文件

- `src/core/economy/diplomacy.ts`：四外交指令领域服务 + 共享判定 helper + 外交规则常量。
- `src/core/economy/diplomacy.test.ts`：四指令 can/下令/月末三关与成功效果、守卫、端到端。

## 修改文件

- `src/core/world/queries.ts`：加 `governorOf`（+ `world/queries.test.ts` 加用例）。
- `src/core/game-state.ts`：`PendingCommand` 加 entice/alienate/instigate/induce 四分支。
- `src/core/shared/config.ts`：加 8 项成本字段 + 默认值。
- `src/core/turn/pending.ts`：第一趟加四分派（+ `turn/pending.test.ts` 视需要）。
- `src/core/game.ts`：`Action` 加四类型 + canApply/apply 分派。

## 任务清单

> 纵切、每条端到端可验证，先让既有测试保持绿。

- [x] 太守派生：`world/queries.governorOf`（红绿：君主在城/不在城取最高有效智力/平局/空城/排除俘虏在野）。
- [x] 配置 + 队列 + Action 接线：`config` 8 项、`PendingCommand` 四分支、`turn/pending` 四分派、`game` 四 Action（编译通过、既有全绿）。
- [x] 招揽：`canEntice`/`entice`/`executeEntice`（红绿：前置拒绝、下令扣减/入队/no-op、三关无安全线、成功迁城+归己+忠诚、守卫）。
- [x] 离间：`canAlienate`/`alienate`/`executeAlienate`（红绿：复用前置/三关、安全线50、成功 −4 下限0、无成功 RNG）。
- [x] 策反：`canInstigate`/`instigate`/`executeInstigate`（红绿：太守且非君主目标、君主在城拒绝、成功自立+整城切换、第三方俘虏不动、不触重选）。
- [x] 劝降：`canInduce`/`induce`/`executeInduce`（红绿：敌君主目标+城池压制、玩家君主免疫、压制月末重校、成功整体吸收+散落转在野）。
- [x] 端到端：四条经 `game.apply` 下令 + `endMonth` 月末结算，按入队序、可复现；既有循环不回归。

> 实现说明：四组 `can*/*/executeX` 收敛于 `economy/diplomacy.ts`；共享 `checkExecutor`（执行人在任+成本）、`enqueueDiplomacy`（下令扣减/占人/入队）、`runThreeGates`（招揽/离间/策反三关）、`isEnemyServingNonLord`/`isInstigateTarget`（目标判定）。离间成功复用 `officer.adjustLoyalty(−4)` 的钳制。共 30 个新测试（含 governorOf 6），全套 336 全绿、`tsc --noEmit` 通过。

## TDD：是

core 全程红绿循环（CONSTITUTION 默认）。本切片不涉 store/ui/AI——AI 不主动使用这四条指令（留 AI 切片）；劝降「玩家君主免疫」规则本切片即落地，为 AI 接入预留。

## 质量自检

- 接口最小自解释：四组 `can*/*/executeX` 沿用既有约定；`governorOf` 单一职责；共享 helper 隐藏在模块内不外泄。✅
- 模块深、职责单一：外交集中 `economy/diplomacy.ts`，三关机器抽 helper 去重；太守归 queries；无 god 模块。✅
- 低改动放大：复用月末队列基建（加四 type 分支 + 四 executeX）；三关逻辑单一真源（helper），未来调外交平衡只动一处常量/旋钮。✅
- YAGNI：不引太守存储字段（派生）；不预实现 AI 使用；不引入外交关系/盟约结构；策反不接 succession（君主即太守不可策反，结构上免除）。✅
- 数据模型无冗余：太守/俘虏/在野均派生（governorOf/isCaptive/lordId）；忠诚单存、君主派生 100；道具归属仍单一真源 holder（招揽/劝降迁人道具随 holder 自动跟随）。✅
- 复用既有：占人/回城用 `busy`+`endMonth`；扣体力/城金用 `spendStamina`/`spendGold`；RNG 穿透同 `executeSearch`/`executeSuborn`；改归属同 `executeSearch`/`resolveSuccession` 先例；城池数用 `citiesOfLord`；有效智力用 `effectiveOfficer`。✅
- 测行为非实现：清单针对状态迁移与四关公式结果/边界（安全线差异、忠诚100必败、太守判定、城池压制、玩家君主免疫、守卫、入队序）。✅
- 依赖方向健康：economy→world/shared、turn→economy、game→economy，无循环；不涉 UI/military。✅

## 决策升级

- **架构红线（升级 `AGENTS.md`）**：
  - **外交四指令归经营·月末**：招揽/离间/策反/劝降的下令阶段与月末执行（含 territorial `lordId`/`cityId` 改写）就近归 `economy/diplomacy`，沿用招降在 economy 改归属的先例，不触 `military`/`world/succession`。
  - **太守为派生（`world/queries.governorOf`）**：君主在城即太守、否则本城最高有效智力在任武将；策反目标须为非君主太守 → 君主不可策反 → 分裂城不含原君主 → 策反不触发重选君主。
  - **core actor-agnostic 的显式例外**：劝降「玩家君主免疫」是游戏规则（非归属校验），`executeInduce` 显式读 `state.playerLordId`、目标为玩家君主即失败。除此外 core 不读 `playerLordId`、不校验归属。
- **术语**：太守/招揽/离间/策反/劝降/外交性格系数 已于 spec-prd 入 `CONTEXT.md`。

## 风险 / 待定

- 招揽/离间/策反「忠诚关」读 raw `officer.loyalty`（目标非君主，raw===派生）；与 `executeSuborn` 口径一致。
- 招揽迁城后目标落执行人**出发城**（`officer.cityId`，busy 不改 cityId）；执行人月末经 endMonth 回城（本就在此城）→ 两者同城，符合「加入执行人所在城」。
- 劝降成功须先按**原势力快照**算 `C`（目标君主城集）与待迁武将集，再统一写回，避免边改边判。
- store/ui 尚未存在：四条均按**执行人归属**（`执行人.lordId===playerLordId`）在 store 派发口校验己方（文档约定）；UI 下令入口（选执行人/敌城与敌目标、策反仅列太守、劝降仅城池压制满足时可下）留 UI 切片。
- `governorOf` 平局取 id 字典序最小，与 `resolveSuccession` 同一确定性约束。

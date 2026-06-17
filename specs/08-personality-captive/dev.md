# personality-captive 开发文档

## 方案概述
延续既有架构：纯函数 `apply(state, action, config)`、`can*/X` 分离、占人用 `Officer.busy`、效果延后指令走 `pendingCommands` 两趟分派、RNG 经 `state.rng` 线性穿过、月末顺序唯一归 `turn/end-month`。本切片三件事：

- **性格**：`Officer` 加一个 `0..4` 的存储字段 `personality`，fixture 播种。**同一值两套解读**——君主（`lordId===自身`）按君主性格表、否则按普通武将性格表，由 `lordId===id` 派生切换、不另存（重选君主后自动改用君主表）。本切片仅普通武将性格驱动招降难度；君主性格仅供 UI 展示、无下游规则。
- **招降（占人 ✓ · 月末执行）**：形态照搬搜寻/掠夺——`economy/suborn.ts` 的 `canSuborn`/`suborn`（扣体力+城金、busy、入队）/`executeSuborn`（月末四关判定，消耗 RNG，成功改俘虏 `lordId`+忠诚）。`PendingCommand` 加 `suborn` 分支、`turn/pending` 第一趟加一个 case、`game` 加一个分派。招降在 `economy` 改归属沿用 `executeSearch` 招募在野武将改 `lordId` 的先例。
- **处斩 / 流放（即时 · 不占人 · 无执行人）**：`economy/captive.ts` 的 `canBehead`/`behead`（退道具回本城+标记已发现、永久删除该武将）与 `canBanish`/`banish`（置在野 `lordId=null`、随机落城、道具随人保留）。即时、不入队、不占任何武将。

关键取舍：

- **硬依赖 `06-debut-search` 先落地**：`lordId: OfficerId | null`（在野）、`Item.discovered` + `discover()`、随机落城均是 06 的基建。本 dev.md 按「06 已实现」撰写；**实现顺序：先 06，后 08**。
- **随机落城抽公共 helper**：新建 `world/placement.ts` 的 `pickRandomCity`（纯函数，消耗 RNG）；`banish` 与 06 的 `world/debut.runDebuts` 共用，避免两处各写一份随机选城（降改动放大）。08 实现时把 `runDebuts` 落城改用此 helper。
- **三指令分两文件**：招降是「占人+月末四关+RNG」的深模块，单独 `economy/suborn.ts`；处斩/流放是「即时、无执行人」的成对处置，合于 `economy/captive.ts`。招降性格系数表内联 `suborn.ts`。
- **core 保持 actor-agnostic**：`can*` 只校验游戏规则前置（城里有俘虏/目标在城/非在任君主等），**不校验归属**。归属留 store 派发口——招降按执行人归属、处斩/流放按**作用城归属**（目标可能是敌方俘虏、无己方执行人）。本仓暂无 store，故仅在文档约定。
- **招降读「原始忠诚」**：`executeSuborn` 直接取 `officer.loyalty`（不走 `officerLoyalty` 派生），故被俘君主按其 raw 忠诚处理；降忠诚写回 `officer.loyalty`（持久，含失败）。

## 接口设计
> 仅签名，不含实现体。

### world/officer.ts（修改：性格字段）
```ts
/** 武将性格：单值 0..4，君主/普通两套表解读同一值（由 lordId===id 派生切换）。 */
export type Personality = 0 | 1 | 2 | 3 | 4

export interface Officer {
  // …既有（含 06 的 lordId: OfficerId | null、recruiterId）…
  readonly personality: Personality
}
```
> 既有聚合纯函数（`troopCapacity`/`spendStamina`/`setBusy`/`adjustLoyalty` 等）签名不变。性格的两套「文字标签」属 UI 展示，不入 core。

### world/placement.ts（新建：随机选城 helper）
```ts
import type { GameState } from '../game-state'
import type { CityId } from '../shared/ids'
import type { Rng } from '../shared/rng'

/** 在全部城中等概率随机选一座（可能含来源城），消耗 RNG。返回选中城与推进后的 rng。debut/banish 共用。 */
export function pickRandomCity(state: GameState): readonly [cityId: CityId, next: Rng]
```

### world/queries.ts（修改：俘虏选择器）
```ts
/** 本城俘虏（isCaptive 为真者）：招降/处斩的候选、UI 列示。派生，无第二份存储。 */
export function captivesInCity(state: GameState, cityId: CityId): Officer[]
```

### game-state.ts（修改：队列加 suborn）
```ts
export type PendingCommand =
  | /* …既有：plunder | campaign | move | transport（+06 的 search）… */
  | { readonly type: 'suborn'; readonly officerId: OfficerId; readonly captiveId: OfficerId }
```

### economy/suborn.ts（新建：招降下令 + 月末执行）
```ts
/** 招降规则身份（内联，不入 config）。 */
// const SUBORN_INTEL_SAFETY = 50              // 智力差安全线：阈值 = 执行人有效智力 − 目标有效智力 + 50
// const SUBORN_COEFF = [1, 3, 4, 5, 2] as const // 按 personality 取招降系数 S（0忠义1/1大志3/2贪财4/3怕死5/4卤莽2）
// const SUBORN_LOYALTY_GATE = 60              // 降之前忠诚 > 60 直接失败
// const SUBORN_LOYALTY_DROP_DIV = 10          // 降忠诚扣减 = floor(L0/10)
// const SUBORN_OK_LOYALTY_MIN = 40, SUBORN_OK_LOYALTY_MAX = 79 // 成功后忠诚 RandInt(40,79)

/** 校验：captiveId 为本城(执行人所在城)俘虏；执行人为该城在任武将；体力≥subornStaminaCost；城金≥subornGoldCost。 */
export function canSuborn(state: GameState, officerId: OfficerId, captiveId: OfficerId, config: GameConfig): CommandCheck
/** 下令：扣执行人体力、扣城金、busy、入队 {type:'suborn',officerId,captiveId}；不动 RNG。非法 no-op。 */
export function suborn(state: GameState, officerId: OfficerId, captiveId: OfficerId, config: GameConfig): GameState
/** 月末单条执行（turn 分派）：四关判定，消耗并写回 state.rng；目标已不存在/已非俘虏则跳过（不动 RNG）。 */
export function executeSuborn(state: GameState, officerId: OfficerId, captiveId: OfficerId): GameState
```

**`executeSuborn` 锁定的 RNG 调用次序**（智力取 `effectiveOfficer` 有效值；忠诚读 `officer.loyalty` raw）：
1. 守卫：目标缺失或 `!isCaptive` → 原样返回（不动 RNG）。
2. **智力差关**：`R1 = RandInt(0,99)`；`阈值 = 执行人有效智力 − 目标有效智力 + 50`；`R1 > 阈值` → 失败（仅消耗 R1、忠诚不变）。
3. **降忠诚**（智力关通过后恒发生、持久化）：`L0 = 目标.loyalty`；`drop = floor(L0/10)`；写回 `目标.loyalty = L0 − drop`；**若 `L0 > 60` → 失败**（扣减保留，不掷 R2）。
4. **性格系数** `S = SUBORN_COEFF[目标.personality]`；**终判** `R2 = RandInt(0,99)`；`失败阈值 = floor((L0−drop)/S)`；`R2 < 失败阈值` → 失败，否则成功。
5. **成功**：`目标.lordId = 执行人.lordId`（归己、派生不再为俘虏）；`R3 = RandInt(40,79)` 写 `目标.loyalty`。

### economy/captive.ts（新建：处斩 + 流放，即时）
```ts
/** 校验处斩：captiveId 存在且为某城俘虏（isCaptive）。 */
export function canBehead(state: GameState, captiveId: OfficerId): CommandCheck
/** 处斩：目标所持道具全部归还其所在城（holder=城）并 discover；从 state.officers 永久删除该武将。无 RNG/成本。非法 no-op。 */
export function behead(state: GameState, captiveId: OfficerId): GameState

/** 校验流放：目标存在于某城；目标不是「在任君主」(lordId===id 且 !isCaptive)。在任武将或俘虏皆可。 */
export function canBanish(state: GameState, officerId: OfficerId): CommandCheck
/** 流放：目标 lordId=null（在野）；pickRandomCity 选落城（消耗 RNG）改 cityId；道具随人保留（holder 不变）。无成本。非法 no-op。 */
export function banish(state: GameState, officerId: OfficerId): GameState
```

### shared/config.ts（修改：招降扁平成本）
```ts
export interface GameConfig {
  // …既有…
  readonly subornStaminaCost: number // 15（招降扣执行人体力，门槛同值）
  readonly subornGoldCost: number    // 100（招降扣本城金，门槛同值）
}
// DEFAULT_CONFIG: subornStaminaCost: 15, subornGoldCost: 100
```

### turn/pending.ts（修改：加 suborn 分派）
```ts
// 第一趟（非 campaign）新增：case 'suborn' → executeSuborn(next, cmd.officerId, cmd.captiveId)
```

### game.ts（修改：加三个 Action）
```ts
export type Action =
  | /* …既有… */
  | { type: 'suborn'; officerId: OfficerId; captiveId: OfficerId } // 招降（占人，月末执行）
  | { type: 'behead'; captiveId: OfficerId }                        // 处斩（即时，不占人）
  | { type: 'banish'; officerId: OfficerId }                        // 流放（即时，不占人）
// canApply/apply 各加三个分派 → canSuborn/suborn、canBehead/behead、canBanish/banish。
```

### world/fixture.ts（修改：播种性格）
- `OfficerSeed` 加 `personality`；每名武将给具体值（君主取君主表含义、普通取普通表含义）；`createInitialState` 物化时带上。
- 06 的 `DEBUT_SEEDS`（未登场武将）同样带 `personality`。

### world/debut.ts（修改：复用随机选城 helper）
- `runDebuts` 未指定 `targetCityId` 时的随机落城改调 `pickRandomCity`（与 banish 同源）。

## 模块职责
- `world/officer.ts`：性格字段 + `Personality` 类型。聚合纯函数签名不变。
- `world/placement.ts`：随机选城（消耗 RNG）。debut/banish 共用的唯一选城处。
- `world/queries.ts`：`captivesInCity` 派生选择器（无第二份存储）。
- `economy/suborn.ts`：招降三件套 + 招降规则系数（智力安全线、性格系数表、忠诚门槛/扣减/成功区间）内联于此。
- `economy/captive.ts`：处斩/流放——即时处置，无执行人、不入队、不动 busy（流放消耗 RNG）。
- `shared/config.ts`：招降扁平成本（体力/城金）。
- `turn/pending.ts`：队列加 `suborn` 分派（编排，不含规则）。
- `game.ts`：三个 Action 的校验/变更分派。
- `world/fixture.ts`：播种性格。
- 依赖方向：`economy/{suborn,captive} → {world, shared}`；`world/placement → {shared}`；`turn/pending → economy`；`game → economy`。无新增循环。

## 要测的行为
- [ ] `pickRandomCity`：在全部城中按 RNG 等概率选一（可能含来源城）、写回推进后的 rng；给定种子可复现。
- [ ] `captivesInCity`：只返回本城俘虏；在野（lordId=null）不计入；非俘虏不计入。
- [ ] `canSuborn` 拒绝：城无俘虏 / captiveId 非本城俘虏 / 执行人不存在或非在任 / 体力 < 15 / 城金 < 100。
- [ ] `suborn` 下令：扣体力 15、城金 100、执行人 busy、入队 `{suborn,officerId,captiveId}`；RNG 不变；非法 no-op。
- [ ] `executeSuborn` 智力差关：`R1 > 执行人有效智力 − 目标有效智力 + 50` → 失败、忠诚不变、仅消耗 R1；有效智力含道具加成。
- [ ] `executeSuborn` 降忠诚：智力关通过后扣 `floor(L0/10)` 并持久（含后续失败）；`L0 > 60` → 失败（扣减保留）。
- [ ] `executeSuborn` 终判：`R2 < floor((L0−drop)/S)` 失败否则成功；系数 `S` 按性格取 `[1,3,4,5,2]`。
- [ ] `executeSuborn` 成功：目标 `lordId=执行人君主`（派生不再为俘虏）、`loyalty=RandInt(40,79)`；执行人经 endMonth 回城（busy=false）。
- [ ] `executeSuborn` 守卫：目标已被处斩/已非俘虏（同月另一招降先成）→ 跳过、不动 RNG、不报错。
- [ ] `canBehead` / `behead`：城有该俘虏可斩；斩后该武将从 officers 移除、其道具 holder 改回本城且 discovered=true；无 RNG/体力/金；非俘虏目标 no-op。
- [ ] `canBanish` / `banish`：目标为在任武将或俘虏（非在任君主）可流放；流放后 `lordId=null`、cityId=随机落城、道具 holder 仍指向其本人（不退城）；被俘君主可流放、在任君主 no-op。
- [ ] `game.apply`/`canApply`：三个 Action 正确分派；endMonth 月末 suborn 在第一趟（非 campaign）按入队序执行、先于 settle 与回城。
- [ ] 同城多招降按入队序结算：先成者使俘虏归己，后续对同一目标的招降守卫跳过。
- [ ] 既有 `develop/recruit/allocate/plunder/scout/campaign/reward/confiscate/patrol/banquet/trade/move/transport/settle/endMonth` + 06 的 `search/debut` 不回归（性格字段默认无副作用）。

## 新建文件
- `src/core/world/placement.ts`：随机选城 helper（`pickRandomCity`）。
- `src/core/economy/suborn.ts`：招降领域服务（`canSuborn`/`suborn`/`executeSuborn`）。
- `src/core/economy/captive.ts`：处斩/流放领域服务（`canBehead`/`behead`/`canBanish`/`banish`）。
- 对应 `*.test.ts`：`world/placement.test.ts`、`economy/suborn.test.ts`、`economy/captive.test.ts`。

## 修改文件
- `src/core/world/officer.ts`：加 `Personality` + `personality` 字段。
- `src/core/world/queries.ts`：加 `captivesInCity`。
- `src/core/world/debut.ts`：`runDebuts` 随机落城改用 `pickRandomCity`。
- `src/core/game-state.ts`：`PendingCommand` 加 `suborn` 分支。
- `src/core/shared/config.ts`：加 `subornStaminaCost`/`subornGoldCost` + 默认值。
- `src/core/turn/pending.ts`：第一趟加 `suborn` 分派。
- `src/core/game.ts`：`Action` 加 `suborn`/`behead`/`banish` + 分派。
- `src/core/world/fixture.ts`：`OfficerSeed` 加 `personality`、播种各武将（含 DEBUT_SEEDS）。

## 任务清单
> 纵切、每条端到端可验证，先让既有（含 06）测试保持绿。
- [x] 性格字段：`Personality` + `officer.personality`；fixture 既有武将与 DEBUT_SEEDS 播种 personality（既有测试全绿）。
- [x] 随机选城：`world/placement.pickRandomCity` + `runDebuts` 改用之（红绿：等概率、可复现；debut 落城不回归）。
- [x] 俘虏选择器：`world/queries.captivesInCity`（红绿）。
- [x] 招降下令：`config` 两项成本 + `economy/suborn.canSuborn/suborn` + `PendingCommand.suborn` + `turn/pending` 分派 + `game` Action（红绿：扣体力/城金、busy、入队、no-op）。
- [x] 招降执行：`executeSuborn` 四关（锁定 RNG 次序）（红绿：智力关、降忠诚持久、>60 失败、终判系数、成功改归属+忠诚、守卫跳过、同城多招降顺序）。
- [x] 处斩：`economy/captive.canBehead/behead` + `game` Action（红绿：删除武将、退道具回城+discovered、非俘虏 no-op）。
- [x] 流放：`economy/captive.canBanish/banish` + `game` Action（红绿：在野化、随机落城、道具随人、在任君主 no-op、被俘君主可流放）。
- [x] 端到端：招降成功转己方 / 处斩删除 / 流放成在野，经 `game.apply`/`endMonth`；同城多招降守卫跳过。

> 实现说明：`pickRandomCity` 拆为 `pickRandomCityWithRng(state, rng)`（debut 循环逐条复用）+ `pickRandomCity(state)`（消耗 state.rng）。处斩函数命名 `behead`（避开 `executeX` 月末执行约定撞名），术语英文统一 Behead。

## TDD：是
core 全程红绿循环（CONSTITUTION 默认）；本切片不涉 store/ui/AI（AI 不主动使用这三条指令，留 AI 切片）。

## 质量自检
- 接口最小自解释：`can*/*/executeX` 沿用既有约定；`pickRandomCity`/`captivesInCity`/三组指令各单一职责。✅
- 模块深、职责单一：招降归 `economy/suborn`、处斩流放归 `economy/captive`、随机选城归 `world/placement`、分派归 `turn/pending`；无 god 模块。✅
- 低改动放大：招降复用月末队列基建（加一 type 分支 + 一 `executeX`）；随机选城抽公共 helper，debut/banish 单一真源；性格仅加字段。✅
- YAGNI：不为性格建独立模块/标签表（标签属 UI）；君主性格只存不消费（占位，PRD 已确认）；不预实现 AI 使用。✅
- 数据模型无冗余：性格单存一处、双表解读为派生；俘虏/在野为派生（isCaptive/lordId）；候选为选择器派生；道具归属仍单一真源 holder。✅
- 复用既有：占人/回城用 `busy`+`endMonth`；扣体力/城金用 officer/city 既有聚合；RNG 穿透同 `develop`/`executeSearch`；改归属同 `executeSearch` 招募先例；道具退城/标记用 `holdByCity`/`discover`。✅
- 测行为非实现：清单针对状态迁移、四关公式结果与边界（智力关、>60、终判阈值、守卫、顺序）。✅
- 依赖方向健康：economy/world→shared、turn→economy、game→economy，无循环；不涉 UI。✅

## 决策升级
- **架构红线（升级 `AGENTS.md`）**：
  - **性格单值双表解读**：`Officer.personality`（0..4）单存一处，君主表/普通表由 `lordId===id` 派生切换、不另存；重选君主后自动改用君主表。
  - **无己方执行人的处置类指令归属口径**：处斩/流放（目标可能是敌方俘虏）按**作用城归属**（`city.lordId===playerLordId`）在 store 派发口校验，区别于占人指令按执行人归属；core 仍 actor-agnostic 不校验归属。
- **术语**：性格/招降/招降性格系数/处斩/流放 已于 spec-prd 入 `CONTEXT.md`（处斩英文统一为 Behead）。

## 风险 / 待定
- **实现顺序硬约束**：须先实现 `06-debut-search`（提供 `lordId` 可空、`Item.discovered`+`discover`、随机落城基建），再实现本切片；否则 `banish`/`behead` 无处落脚。
- `executeSuborn` 读 raw `officer.loyalty`：被俘君主 raw 忠诚（fixture 100）> 60 故初期必失败，需多次招降把忠诚磨到 ≤60 后方可成功——与设计一致（君主难招降）。
- 处斩被俘君主仅删除该武将，不触发重选君主/全局胜负（重选只在「君主被俘」时触发，删除是另一事实）；统一全国胜负判定不在本切片。
- `pickRandomCity` 确定性依赖 `Object.keys(state.cities)` 插入序稳定（fixture 按 `CITY_SEEDS` 序插入，稳定）；与 06 `runDebuts` 同一约束。
- store/ui 尚未存在，归属校验为文档约定；UI 下令入口（选俘虏/执行人/目标、性格展示）留 UI 切片。

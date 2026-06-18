# troops 开发文档

## 方案概述

延续 `01-economy-loop` 既有架构：纯函数 reducer `apply(state, action, config)`、可变态收敛在 `GameState`、不可变数值收敛在 `GameConfig`、领域服务「校验(can*) 与变更(*) 分离」。本切片新增两条指令：

- **征兵 recruit**：占人指令，沿用既有「下令离城 → 月末回城」机制（与开垦/招商同构），无随机性（不推进 RNG）。
- **分配 allocate**：不占人、立即生效，在城后备兵与某武将兵之间重分配，无随机性。

关键取舍：

- **recruit / allocate 拆两个文件**：二者行为差异大（占人/扣资源 vs 不占人/重分配），不像开垦/招商那样近重复，强行合并会让单文件承担两套语义。各自单一职责。
- **校验类型上提**：把 `develop.ts` 里的 `DevelopCheck` 提为 `shared/command.ts` 的 `CommandCheck`，develop/recruit/allocate 与 `game.canApply` 共用一套校验返回形状，避免重复定义、收敛 UI 契约。
- **带兵量上限作为 Officer selector**：`troopCapacity(officer, config)` 放 `officer.ts`（它是武将的固有派生属性），供 allocate、UI、未来战斗复用；公式系数走 config 注入。
- **新状态无冗余**：后备兵（城级）与武将兵（武将级）是两份独立真实状态，非双向引用；民忠本切片静态。
- **复用既有月末编排**：征兵的「月末回城」直接由现有 `endMonth` 处理（它把所有 busy 武将置回），本切片不动 turn 层。

## 接口设计

> 仅签名，不含实现体。

### shared/command.ts（新建）

```ts
/** 指令前置校验结果：ok 为 false 时 reason 给出可展示给玩家的原因。 */
export interface CommandCheck {
  readonly ok: boolean
  readonly reason?: string
}
```

### shared/config.ts（修改：新增字段）

config 只放「平衡旋钮」（成本/阈值，会调、要测注入）；公式系数属「规则身份」，内联到对应领域模块，不进 config。

```ts
export interface GameConfig {
  // ...既有字段...
  /** 征兵消耗的执行人体力（扁平成本，可调）。 */
  readonly recruitStaminaCost: number // 12
}
```

不进 config 的（内联常量 / 字面量）：

- 征兵转化率 `民忠×20`、`金×10`（可征上限 = min(民忠×20, 金×10)；扣金 = ceil(N/10)，与金转化率同源）→ `recruit.ts` 模块常量（转化率即规则身份）。
- 带兵量**复合公式**系数 `100 / 10 / 10` → `officer.ts` 模块常量（整组系数即规则身份，不拆进 config）。
- 征兵门槛「城金 ≥ 1」、各 `≥ 0` 下限 → 字面量（琐碎守卫）。
- 民忠上限 `100` → 固定量纲上限，本切片静态、仅 fixture 体现，不做运行时夹取（YAGNI）。

### world/officer.ts（修改：新增字段 + 操作）

```ts
export interface Officer {
  // ...既有: id/name/intelligence/lordId/cityId/stamina/busy...
  /** 当前带兵数，[0, 带兵量上限]。 */
  readonly troops: number
  /** 等级，静态；带兵量公式用。本切片不成长。 */
  readonly level: number
  /** 武力，静态；带兵量公式用。 */
  readonly force: number
}

/** 带兵量公式系数（规则身份，内联，不入 config）。 */
// const TROOP_CAP_PER_LEVEL = 100, TROOP_CAP_PER_FORCE = 10, TROOP_CAP_PER_INTEL = 10
/** 带兵量上限（派生）= 等级×100 + 武力×10 + 智力×10。 */
export function troopCapacity(o: Officer): number
/** 设置武将兵，不低于 0（不变量）。调用方应已校验不超带兵量上限。 */
export function setTroops(o: Officer, troops: number): Officer
```

### world/city.ts（修改：新增字段 + 操作）

```ts
export interface City {
  // ...既有: id/name/lordId/agriculture/commerce/agricultureCap/commerceCap/gold/food...
  /** 民忠 [0,100]，决定征兵上限；本切片静态。 */
  readonly loyalty: number
  /** 后备兵（未编队），>= 0。 */
  readonly reserveTroops: number
}

/** 增减后备兵（delta 可负），结果不低于 0（不变量）。 */
export function addReserveTroops(c: City, delta: number): City
```

### economy/recruit.ts（新建）

转化率为内联规则常量；只有扁平的体力成本走 config。

```ts
/** 征兵转化率（规则身份，内联，不入 config）。 */
// const TROOPS_PER_LOYALTY = 20, TROOPS_PER_GOLD = 10
/** 可征上限 = min(民忠 × 20, 金 × 10)。 */
export function recruitMaxTroops(city: City): number
/** 征兵扣金 = ceil(N / 10)（与金转化率同源；不足一档也按 1 起收）。 */
export function recruitGoldCost(amount: number): number

export function canRecruit(
  state: GameState,
  cityId: CityId,
  officerId: OfficerId,
  amount: number,
  config: GameConfig
): CommandCheck
// 即时：后备兵 += N；执行人体力 -= config.recruitStaminaCost；城金 -= ceil(N/10)；执行人 busy；不动 RNG。
export function recruit(
  state: GameState,
  cityId: CityId,
  officerId: OfficerId,
  amount: number,
  config: GameConfig
): GameState
```

canRecruit 校验：城/武将存在 → 武将在该城且未占用 → 城金 ≥ 1 → 体力 ≥ recruitStaminaCost → 1 ≤ amount ≤ recruitMaxTroops。

### economy/allocate.ts（新建）

分配不扣资源、带兵量系数已内联，故无需 config 参数。

```ts
/** 可分配上限 = min(带兵量上限, 后备兵 + 武将现有兵)。 */
export function allocateMaxTroops(officer: Officer, city: City): number

export function canAllocate(
  state: GameState,
  cityId: CityId,
  officerId: OfficerId,
  amount: number
): CommandCheck
// 即时：后备兵 += (武将原兵 − N)；武将兵 = N；不占人、不扣体力/金、不动 RNG。
export function allocate(
  state: GameState,
  cityId: CityId,
  officerId: OfficerId,
  amount: number
): GameState
```

canAllocate 校验：城/武将存在 → 武将在该城且未占用（作为分配目标）→ 0 ≤ amount ≤ allocateMaxTroops。

### economy/develop.ts（修改）

```ts
// 删除本地 DevelopCheck，改用 shared 的 CommandCheck
export function canDevelop(...): CommandCheck
export function develop(...): GameState   // 不变
```

### game.ts（修改）

```ts
export type Action =
  | { type: 'reclaim'; cityId: CityId; officerId: OfficerId }
  | { type: 'commerce'; cityId: CityId; officerId: OfficerId }
  | { type: 'recruit'; cityId: CityId; officerId: OfficerId; amount: number }
  | { type: 'allocate'; cityId: CityId; officerId: OfficerId; amount: number }
  | { type: 'endMonth' }

export function canApply(state: GameState, action: Action, config?: GameConfig): CommandCheck
export function apply(state: GameState, action: Action, config?: GameConfig): GameState
```

### world/fixture.ts（修改）

新字段以统一 mock 常量注入（不逐人配，凸显 mock）：`level=1`、`force=50`、`troops=100`（武将）；`loyalty=50`、`reserveTroops=0`（城）。

## 模块职责

- `shared/command.ts`：指令校验返回类型唯一来源。被 develop/recruit/allocate 与 game.canApply 共用。
- `shared/config.ts`：新增征兵与带兵量公式数值。边界：只放数值。
- `world/officer.ts`：新增 troops/level/force 字段、`troopCapacity` 派生、`setTroops` 不变量。
- `world/city.ts`：新增 loyalty/reserveTroops 字段、`addReserveTroops` 不变量。
- `economy/recruit.ts`：征兵规则（上限/扣金公式 + canRecruit + recruit）。
- `economy/allocate.ts`：分配规则（上限 + canAllocate + allocate）。
- `game.ts`：新增 recruit/allocate 两个 Action 的分派与校验委派。
- 依赖方向：`economy/{recruit,allocate} -> {world, shared}`；`game -> economy`；`world -> shared`。无新增循环。

## 要测的行为

- [x] recruitMaxTroops = min(民忠×20, 金×10)；recruitGoldCost = ceil(N/10)，N<10 时为 1。
- [x] recruit：后备兵 += N、城金 -= ceil(N/10)、执行人体力 -= 12、busy=true；RNG 不变。
- [x] canRecruit 拒绝：无在任武将 / 城金 < 1 / 体力 < 12 / amount < 1 / amount > 上限，各返回 ok=false 与 reason。
- [x] recruit 非法时 no-op（原样返回 state）。
- [x] 征兵占人后，经 endMonth 月末回城（busy=false）。
- [x] troopCapacity = 等级×100 + 武力×10 + 智力×10。
- [x] allocateMaxTroops = min(带兵量上限, 后备兵 + 武将原兵)。
- [x] allocate 双向：N > 原兵（城→武将）、N < 原兵（上交）、N = 0（全交）——后备兵 = 原后备兵 + 原兵 − N、武将兵 = N。
- [x] allocate 不扣体力/金、不占人（busy 不变）；RNG 不变。
- [x] canAllocate 拒绝：amount > 带兵量上限 / amount > 后备兵+原兵 / amount < 0 / 武将不在该城或已占用。
- [x] allocate 后同月该武将仍可被下其它令（如随后 recruit）。
- [x] 既有 develop/settle/endMonth 行为不回归（DevelopCheck→CommandCheck 重命名后类型仍通过）。
- [x] 配置注入：改 recruitStaminaCost 能改变征兵体力消耗；转化率与带兵量公式系数为内联规则常量，按精确值断言（不经 config）。
- [x] 确定性：相同 seed + 相同动作序列，结果一致。

## 新建文件

- `src/core/shared/command.ts`：CommandCheck 校验返回类型。
- `src/core/economy/recruit.ts`：征兵领域服务。
- `src/core/economy/allocate.ts`：分配领域服务。
- `src/core/economy/recruit.test.ts`：征兵行为测试。
- `src/core/economy/allocate.test.ts`：分配行为测试。

## 修改文件

- `src/core/shared/config.ts`：新增征兵/带兵量字段与 DEFAULT_CONFIG 默认值。
- `src/core/world/officer.ts`：新增 troops/level/force 字段、troopCapacity、setTroops。
- `src/core/world/city.ts`：新增 loyalty/reserveTroops 字段、addReserveTroops。
- `src/core/world/fixture.ts`：seed 注入新字段（统一 mock 值）。
- `src/core/economy/develop.ts`：DevelopCheck → 引用 CommandCheck。
- `src/core/game.ts`：Action 新增 recruit/allocate；canApply/apply 分派；返回类型改 CommandCheck。

## 任务清单

- [x] shared/command：CommandCheck；develop.ts 与 game.ts 切换引用（确保既有测试绿）。
- [x] config：新增征兵/带兵量字段 + 默认值。
- [x] world/officer：troops/level/force + troopCapacity + setTroops（含夹取测试）。
- [x] world/city：loyalty/reserveTroops + addReserveTroops（含夹取测试）。
- [x] world/fixture：注入新字段（mock 值）。
- [x] economy/recruit：recruitMaxTroops/recruitGoldCost + canRecruit + recruit（红绿覆盖上限/扣金/扣减/校验/no-op）。
- [x] economy/allocate：allocateMaxTroops + canAllocate + allocate（红绿覆盖双向/上限/校验/不占人）。
- [x] game：接入 recruit/allocate 两个 Action；端到端（征兵→月末回城、分配后同月再下令）确定性测试。

## TDD：是

core 全程红绿循环（CONSTITUTION 默认）；UI/store 不在本切片。

## 质量自检

- 接口最小自解释：can*/* 配对沿用既有约定；上限/扣金抽成可单测的纯函数（recruitMaxTroops/recruitGoldCost/troopCapacity/allocateMaxTroops）。✅
- 模块深、职责单一：recruit/allocate 各自独立；带兵量上限归 Officer。无 god 模块。✅
- 低改动放大：校验类型上提为 CommandCheck，后续新增指令直接复用。✅
- config 取舍得当（依 CONSTITUTION「配置 vs 内联」）：config 只放扁平成本 recruitStaminaCost；规则身份全内联（征兵转化率 民忠×20/金×10、带兵量复合公式系数 100/10/10、民忠上限 100）；门槛/下限用字面量。✅
- 无提前抽象：未引入兵种/编队/事件总线；民忠上限不入 config（静态）。✅
- 数据模型无冗余：后备兵/武将兵为独立真实状态，非双向引用；民忠静态。✅
- 复用既有：占人月末回城复用 endMonth；扣金/体力复用 city/officer 既有聚合操作。✅
- 测行为非实现：清单针对公式结果与状态迁移，不绑实现步骤。✅
- 依赖方向健康：economy → world/shared，无循环；UI 不涉及。✅

## 决策升级

- 术语「兵/后备兵/武将兵/民忠/武力/等级/带兵量上限/征兵/分配」已在 spec-prd 阶段写入 `CONTEXT.md`。
- `CommandCheck` 作为「指令校验统一返回形状」是跨功能约定，登记到 `AGENTS.md` 架构红线。

## 风险 / 待定

- 民忠本切片静态；其涨跌/恢复、征兵是否伤民忠（已定不伤）留后续切片。
- 武力/民忠为 mock 占位值（统一 50）、等级统一 1 不成长，平衡留后续。
- 征兵无随机性，与 develop 不同——不推进 RNG，确定性测试需覆盖「RNG 不变」。

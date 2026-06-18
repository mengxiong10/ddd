# economy-loop 开发文档

## 方案概述

核心是纯函数 reducer：`apply(state, action, config) -> newState`。可变态全部收敛在 `GameState`（含 RNG seed，保证 `apply` 仍是确定性纯函数）；不可变数值全部收敛在 `GameConfig`（`DEFAULT_CONFIG`，第三参注入，不进 state）——这就是"可变/不可变分离"。

关键取舍：

- **开垦/招商共用一个参数化领域服务** `develop(..., kind)`，避免两份近重复代码；将来新增同类内政指令只加一个 `kind` 分支。
- **单一变更入口**：`reclaim`/`commerce`/`endMonth` 都是 `Action`，由 `apply` 分派。`endMonth` 是阶段推进，委派 `turn.endMonth`。
- **校验与变更分离**：`canApply` 给 UI 做置灰/提示；`apply` 内部仍守卫，非法即 no-op。
- **AI 留空步 seam**：`endMonth` 调 `ai.aiTakeTurn`（本切片返回原 state），未来接入 AI 只动一处。

## 接口设计

> 仅签名，不含实现体。

### shared/config.ts

```ts
export type DevelopKind = 'agriculture' | 'commerce'

// config 只放「扁平成本 + 恢复速率」（平衡旋钮）；公式/除数/日历/量纲上限属规则身份，内联到领域模块（见 CONSTITUTION「配置 vs 内联常量」）。
export interface GameConfig {
  commandGoldCost: number // 50
  commandStaminaCost: number // 8
  staminaRecoveryPerMonth: number // 4
}

export const DEFAULT_CONFIG: GameConfig

// 以下为内联规则常量，不在 config：
//  world/officer.ts   : STAMINA_MAX = 100（固定量纲上限）
//  economy/develop.ts : DEVELOP_INTEL_DIVISOR = 5、DEVELOP_RAND_MAX = 30（增量公式）
//  economy/settle.ts  : HARVEST_DIVISOR = 4、TAX_DIVISOR = 2、HARVEST_MONTHS = [6,10]、TAX_MONTHS = [3,6,9,12]
```

### shared/rng.ts

```ts
export interface Rng {
  readonly seed: number
}
export function createRng(seed: number): Rng
// 含两端；返回值与推进后的新 rng，纯函数
export function randInt(rng: Rng, min: number, max: number): readonly [value: number, next: Rng]
```

### shared/ids.ts

```ts
export type CityId = string
export type OfficerId = string // 君主也是 Officer，归属用 lordId: OfficerId 表达
```

### world/officer.ts

```ts
export interface Officer {
  readonly id: OfficerId
  readonly name: string
  readonly intelligence: number // 静态
  readonly lordId: OfficerId // 归属君主（君主本人 lordId 指向自身）
  readonly cityId: CityId // 所属城（本切片不跨城移动）
  readonly stamina: number // 可变，[0, staminaMax]
  readonly busy: boolean // true=本月已被占用/离城
}
// 聚合操作（纯函数，含不变量：stamina 夹在 [0, max]）
export function spendStamina(o: Officer, amount: number): Officer
export const STAMINA_MAX: number // 100（固定量纲上限，内联常量）
export function recoverStamina(o: Officer, amount: number): Officer // 封顶 STAMINA_MAX
export function setBusy(o: Officer, busy: boolean): Officer
```

### world/city.ts

```ts
export interface City {
  readonly id: CityId
  readonly name: string
  readonly lordId: OfficerId // 归属君主
  readonly agriculture: number // [0, agricultureCap]
  readonly commerce: number // [0, commerceCap]
  readonly agricultureCap: number // 城级上限（各城可不同）
  readonly commerceCap: number // 城级上限
  readonly gold: number
  readonly food: number
  // 注：不存驻城武将列表——由 Officer.cityId 反推（officersInCity），避免冗余状态
}
// 聚合操作（含不变量：属性不超过城级上限、资源不为负）
export function attributeCap(c: City, kind: DevelopKind): number // 按 kind 取 agricultureCap/commerceCap
export function raiseAttribute(c: City, kind: DevelopKind, delta: number): City // 内部按 attributeCap 截断
export function spendGold(c: City, amount: number): City
export function addFood(c: City, amount: number): City
export function addGold(c: City, amount: number): City
```

### world/queries.ts

```ts
// 在任武将 = 属于该城 && !busy
export function officersInCity(
  state: GameState,
  cityId: CityId,
  opts?: { onlyAvailable?: boolean }
): Officer[]
export function citiesOfLord(state: GameState, lordId: OfficerId): City[]
```

### world/fixture.ts

```ts
// 玩家/AI 各 2 城的固定初始局面（见 PRD 表），seed 注入 RNG
export function createInitialState(seed: number): GameState
```

### game-state.ts

```ts
export interface GameState {
  readonly year: number
  readonly month: number // 1..12
  readonly playerLordId: OfficerId // 哪位君主是玩家（替代 Force.isPlayer）
  readonly cities: Readonly<Record<CityId, City>>
  readonly officers: Readonly<Record<OfficerId, Officer>>
  readonly rng: Rng // 可变态的随机源
}
```

### economy/develop.ts

```ts
// 开垦/招商共用领域服务
export function canDevelop(
  state: GameState,
  cityId: CityId,
  officerId: OfficerId,
  kind: DevelopKind,
  config: GameConfig
): { ok: boolean; reason?: string }

export function develop(
  state: GameState,
  cityId: CityId,
  officerId: OfficerId,
  kind: DevelopKind,
  config: GameConfig
): GameState // 即时：增量=floor(智力/divisor)+randInt(0,randMax)，按城级上限截断；扣金/体力；officer busy；推进 rng
```

### economy/settle.ts

```ts
export function harvestAmount(agriculture: number): number // floor(agri / HARVEST_DIVISOR)
export function taxAmount(commerce: number): number // floor(commerce / TAX_DIVISOR)
// 按当前 state.month 判定（HARVEST_MONTHS/TAX_MONTHS 内联），对所有城收粮(入 food)/收税(入 gold)
export function settle(state: GameState): GameState
```

### turn/end-month.ts

```ts
// 阶段推进：AI 空步 -> settle -> 回城(busy=false) -> 体力+recovery(封顶) -> 月份+1(跨年)
export function endMonth(state: GameState, config: GameConfig): GameState
```

### ai/ai.ts

```ts
// 本切片 AI 静止，返回原 state（保留 seam，未来接入只动此处）
export function aiTakeTurn(state: GameState, config: GameConfig): GameState
```

### game.ts

```ts
export type Action =
  | { type: 'reclaim'; cityId: CityId; officerId: OfficerId } // 开垦 -> agriculture
  | { type: 'commerce'; cityId: CityId; officerId: OfficerId } // 招商 -> commerce
  | { type: 'endMonth' }

export function apply(state: GameState, action: Action, config?: GameConfig): GameState
export function canApply(
  state: GameState,
  action: Action,
  config?: GameConfig
): { ok: boolean; reason?: string }
```

## 模块职责

- `shared/config.ts`：不可变数值唯一来源（GameConfig + DEFAULT_CONFIG）。农业/商业上限不在此（已下放到城级）。边界：只放数值，不放逻辑。
- `shared/rng.ts`：确定性随机，纯函数推进。被 economy 使用，不依赖任何上下文。
- `shared/ids.ts`：ID 类型别名。
- `world/*`：领域数据与聚合不变量（Officer/City）、查询、初始 fixture。归属用 `lordId`（君主即 Officer），无独立 Force 实体。不含跨上下文流程。
- `economy/develop.ts`：内政开发规则（开垦/招商），含 canDevelop 校验与 develop 变更。
- `economy/settle.ts`：月末收粮/收税结算 + 公式纯函数。
- `turn/end-month.ts`：月度阶段编排，串起 ai/economy/world 的月末动作。唯一知道"月末顺序"的地方。
- `ai/ai.ts`：AI 决策入口（本切片空步）。
- `game.ts`：唯一对外变更入口，Action 分派 + canApply 委派。store 只调它。
- 依赖方向：`game -> {turn, economy, world}`；`turn -> {ai, economy, world}`；`economy -> {world, shared}`；`world -> shared`。无循环。

## 要测的行为

- [x] reclaim：农业 += floor(智力/5)+randInt(0,30)，不超过上限；城金 -50、执行武将体力 -8、busy=true。
- [x] commerce：同理作用于商业。
- [x] canApply 拒绝：城内无在任武将 / 该属性已达上限 / 城金<50 / 体力<8，各返回 ok=false 与 reason。
- [x] 已 busy 的武将不能再被下令（不计入在任）。
- [x] develop 达上限时按 min 截断，不溢出。
- [x] harvestAmount/taxAmount 公式正确（含取整）。
- [x] settle：6 月收粮+收税；10 月仅收粮；3/9/12 月仅收税；其余月份无变化（对每座城含 AI 城）。
- [x] endMonth：触发 settle、所有 busy 武将回城(busy=false)、已登场武将体力 +4 封顶 100、月份 +1、12 月→次年 1 月。
- [x] 确定性：相同 seed 跑相同动作序列，结果一致。
- [x] 配置注入：改 GameConfig（成本/恢复）能改变对应行为；公式除数/结算月份为内联规则常量，按精确值断言（不再经 config 注入）。

## 新建文件

- `src/core/shared/config.ts`：GameConfig + DEFAULT_CONFIG
- `src/core/shared/rng.ts`：确定性 RNG
- `src/core/shared/ids.ts`：ID 类型
- `src/core/world/officer.ts`：Officer 聚合（含 lordId 归属）
- `src/core/world/city.ts`：City 聚合（含城级上限、lordId 归属）
- `src/core/world/queries.ts`：跨实体查询/选择器
- `src/core/world/fixture.ts`：初始局面 createInitialState
- `src/core/game-state.ts`：GameState 根类型
- `src/core/economy/develop.ts`：开垦/招商领域服务
- `src/core/economy/settle.ts`：收粮/收税结算
- `src/core/turn/end-month.ts`：月末编排
- `src/core/ai/ai.ts`：AI 空步 seam
- `src/core/game.ts`：apply / canApply 入口
- 对应 `*.test.ts`：develop / settle / end-month / game(canApply) / rng
- 项目脚手架：`package.json`、`tsconfig.json`、`vite.config.ts`、`vitest` 配置（首个切片需初始化）

## 修改文件

- 暂无（首个功能切片，全新建）。UI/store 留到后续切片接入。

## 任务清单

- [x] 初始化项目脚手架（Vite + React + TS 严格模式 + Vitest），确保 `vitest` 可跑。
- [x] shared：config、rng（含 randInt 测试）、ids。
- [x] world：Officer/City 聚合 + 不变量（含 lordId 归属、城级上限）；queries；fixture（createInitialState）。
- [x] economy/develop：canDevelop + develop（红绿循环覆盖增量/上限/扣减/校验）。
- [x] economy/settle：harvestAmount/taxAmount + settle（按月份分支）。
- [x] turn/end-month：编排顺序（settle→回城→体力→月份），含跨年。
- [x] ai：aiTakeTurn 空步。
- [x] game：Action 分派 + canApply；端到端推进多月的确定性测试。

## TDD：是

core 全程红绿循环；UI/store 不在本切片。

## 风险 / 待定

- `ai.aiTakeTurn` 空步属于"为未来留 seam"，是经过权衡的低改动放大设计，非投机抽象。
- 体力恢复采用每月 +4（见 PRD）；后续"恢复体力指令"留到相关切片。
- 初始 fixture 数值为可调默认，平衡后续再说。

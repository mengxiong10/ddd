# city-commands 开发文档

## 方案概述

5 条指令全部复用既有范式：`economy/<cmd>.ts` 写 `can<Cmd>`/`<cmd>` 两段纯函数，经 `game.ts` 的 `Action` + `canApply/apply` 分派；占人用 `Officer.busy`，月末由 `endMonth` 统一回城。按「效果时机」分两类：

- **即时类（不入 `pendingCommands`）**：出巡、宴请、交易——效果在下令瞬间结算（与开垦/侦察/赏赐同构）。
  - 出巡、交易：占人（`busy`），回城由既有 `endMonth` 处理；出巡消费 RNG（`RandInt(1,4)`），交易不消费。
  - 宴请：不占人（不动 `busy`）、不消费 RNG，目标须为该城在任武将（与赏赐/没收同为「目标即武将」的即时指令）。
- **月末类（入 `pendingCommands`，新增两个判别式分支）**：移动、输送——下令仅占人/扣减+入队，效果延到月末，由 `turn/pending` 按 type 分派（非 campaign 趟）。
  - 移动：占人例外（同出征）——`executeMove` 月末改 `officer.cityId` 为目标城，不回出发城。
  - 输送：下令即从出发城扣资源；`executeTransport` 月末消费 RNG，80% 送达 / 20% 永损；执行人照常回出发城。

关键取舍：

- **每条指令一个文件**（patrol/banquet/move/transport/trade），与既有 develop/recruit/plunder/scout/campaign 单文件一致；不分组、不抽公共「指令基类」（YAGNI，`can/X` 形态已是统一约定）。
- **月末执行就近留 `economy/`**：移动/输送是经营域调度，`executeMove`/`executeTransport` 与各自下令同文件（与 `executePlunder` 同构），`turn/pending` 仅加两个分派分支，不动两趟逻辑（移动/输送均非 campaign，落第一趟）。
- **人口为展示状态**：`City` 新增 `population`，仅出巡 +100、fixture 播种；本切片无任何下游读取（已与用户确认，明知 YAGNI 风险，记入风险区）。
- **扁平成本逐指令独立 key**（用户定）：出巡值与开垦巧合相等，仍各设 key，避免平衡耦合。

## 接口设计

> 仅签名，不含实现体。

### shared/config.ts（修改：新增 5 个扁平成本）

```ts
export interface GameConfig {
  // …既有…
  readonly patrolStaminaCost: number // 8
  readonly patrolGoldCost: number // 50
  readonly banquetGoldCost: number // 100
  readonly transportStaminaCost: number // 8
  readonly tradeStaminaCost: number // 12
}
```

不进 config（内联规则身份）：出巡民忠随机幅度 `RandInt(1,4)`、人口增量 100（`patrol.ts`）；宴请体力回 50、忠诚 +1（`banquet.ts`）；输送送达概率 80%（`transport.ts`）；交易买价 5、卖价 2（`trade.ts`）；民忠量纲上限 100（`city.ts`）。

### world/city.ts（修改：新增字段 + 两个聚合操作）

```ts
/** 民忠量纲上限（百分制，固定值；规则身份，不入 config）。 */
export const CITY_LOYALTY_MAX = 100

export interface City {
  // …既有…
  /** 人口；出巡 +100。06 切片为展示状态，无下游规则。 */
  readonly population: number
}

/** 民忠回升，钳制 [0, CITY_LOYALTY_MAX]（不变量）。出巡用。 */
export function gainLoyalty(c: City, delta: number): City
/** 增加人口（delta ≥ 0）。出巡用。 */
export function addPopulation(c: City, delta: number): City
```

> 输送两端的金/粮/后备兵复用既有 `addGold/spendGold/addFood/spendFood/addReserveTroops`，不新增。

### economy/patrol.ts（新建·即时·占人·消费 RNG）

```ts
// 内联规则身份：PATROL_LOYALTY_RAND_MIN=1, PATROL_LOYALTY_RAND_MAX=4, PATROL_POPULATION_GAIN=100
export function canPatrol(state: GameState, officerId: OfficerId, config: GameConfig): CommandCheck
// 即时：民忠 += randInt(1,4)（封顶100）、人口 +=100、扣体力 patrolStaminaCost、扣本城金 patrolGoldCost、busy、推进 RNG；不入队。非法 no-op。
export function patrol(state: GameState, officerId: OfficerId, config: GameConfig): GameState
```

`canPatrol` 校验：武将存在、未占用、非俘虏 → 本城存在 → 本城金 ≥ `patrolGoldCost` → 体力 ≥ `patrolStaminaCost`。

### economy/banquet.ts（新建·即时·不占人）

```ts
// 内联规则身份：BANQUET_STAMINA_GAIN=50, BANQUET_LOYALTY_GAIN=1
export function canBanquet(state: GameState, officerId: OfficerId, config: GameConfig): CommandCheck
// 即时：扣本城金 banquetGoldCost、目标体力 +50（封顶 STAMINA_MAX）、非君主忠诚 +1（封顶 LOYALTY_MAX）；不动 busy、不入队、不耗 RNG。非法 no-op。
export function banquet(state: GameState, officerId: OfficerId, config: GameConfig): GameState
```

`canBanquet` 校验：目标武将存在、**未占用且非俘虏（在任）** → 本城存在 → 本城金 ≥ `banquetGoldCost`。君主跳过忠诚写入（`officer.lordId === officer.id`），与赏赐/没收一致。

### economy/move.ts（新建·月末·占人例外）

```ts
export function canMove(state: GameState, officerId: OfficerId, targetCityId: CityId): CommandCheck
// 下令：busy、入队 {type:'move', officerId, targetCityId}；不扣体力/金、不耗 RNG。非法 no-op。
export function move(state: GameState, officerId: OfficerId, targetCityId: CityId): GameState
// 月末（turn/pending 分派，非 campaign 趟）：officer.cityId = targetCityId（占人例外，不回出发城；busy 由 endMonth 翻回）。
export function executeMove(state: GameState, officerId: OfficerId, targetCityId: CityId): GameState
```

`canMove` 校验：武将存在、未占用、非俘虏 → 本城存在 → 目标城存在、`targetCityId !== officer.cityId`、`target.lordId === officer.lordId`（己方城）。

### economy/transport.ts（新建·月末·占人·月末消费 RNG）

```ts
// 内联规则身份：TRANSPORT_SUCCESS_PERCENT=80
export function canTransport(
  state: GameState,
  officerId: OfficerId,
  targetCityId: CityId,
  food: number,
  gold: number,
  troops: number,
  config: GameConfig
): CommandCheck
// 下令：扣体力 transportStaminaCost、从出发城扣 food/gold/troops（后备兵）、busy、入队 transport；不耗 RNG。非法 no-op。
export function transport(
  state: GameState,
  officerId: OfficerId,
  targetCityId: CityId,
  food: number,
  gold: number,
  troops: number,
  config: GameConfig
): GameState
// 月末（turn/pending 分派，非 campaign 趟）：randInt 判 80% 送达→目标城 +food/+gold/+后备兵；20% 永损（不退回）。执行人 cityId 不变（busy 由 endMonth 翻回）。推进 RNG。
export function executeTransport(
  state: GameState,
  officerId: OfficerId,
  targetCityId: CityId,
  food: number,
  gold: number,
  troops: number
): GameState
```

`canTransport` 校验：武将存在、未占用、非俘虏 → 本城存在 → 体力 ≥ `transportStaminaCost` → 目标城存在、`!== 本城`、`target.lordId === officer.lordId` → food/gold/troops 均为整数且 `≥0`、`food ≤ 本城粮`、`gold ≤ 本城金`、`troops ≤ 本城后备兵`。

### economy/trade.ts（新建·即时·占人）

```ts
export type TradeMode = 'buy' | 'sell'
// 内联规则身份：TRADE_BUY_GOLD_PER_FOOD=5, TRADE_SELL_GOLD_PER_FOOD=2
export function canTrade(
  state: GameState,
  officerId: OfficerId,
  mode: TradeMode,
  amount: number,
  config: GameConfig
): CommandCheck
// 即时：buy → 粮 +=amount、金 -=amount×5；sell → 粮 -=amount、金 +=amount×2；扣体力 tradeStaminaCost、busy；不入队、不耗 RNG。非法 no-op。
export function trade(
  state: GameState,
  officerId: OfficerId,
  mode: TradeMode,
  amount: number,
  config: GameConfig
): GameState
```

`canTrade` 校验：武将存在、未占用、非俘虏 → 本城存在 → 体力 ≥ `tradeStaminaCost` → `amount` 整数且 `≥0` → buy 时 `amount ≤ floor(本城金/5)`；sell 时 `amount ≤ 本城粮`。

### game-state.ts（修改：PendingCommand 增两分支）

```ts
export type PendingCommand =
  | { readonly type: 'plunder'; readonly officerId: OfficerId }
  | { readonly type: 'campaign' /* …既有… */ }
  | { readonly type: 'move'; readonly officerId: OfficerId; readonly targetCityId: CityId }
  | {
      readonly type: 'transport'
      readonly officerId: OfficerId
      readonly targetCityId: CityId
      readonly food: number
      readonly gold: number
      readonly troops: number
    }
```

### game.ts（修改：Action 增 5 条）

```ts
export type Action =
  | /* …既有… */
  | { type: 'patrol'; officerId: OfficerId }
  | { type: 'banquet'; officerId: OfficerId }
  | { type: 'move'; officerId: OfficerId; targetCityId: CityId }
  | { type: 'transport'; officerId: OfficerId; targetCityId: CityId; food: number; gold: number; troops: number }
  | { type: 'trade'; officerId: OfficerId; mode: TradeMode; amount: number }
// canApply/apply 各加 5 分支，委派各 economy 服务。归属（己方）不在 core，留 store/AI 入口。
```

### turn/pending.ts（修改：增两分派分支）

```ts
// switch 增 case 'move' → executeMove、case 'transport' → executeTransport；二者非 campaign，落第一趟（两趟逻辑不变）。
```

### world/fixture.ts（修改）

`CitySeed` + `createInitialState` 增 `population`（各城播种一个 mock 值，凸显占位、展示用）。

## 模块职责

- `shared/config.ts`：新增 5 个扁平成本旋钮，仅数值。
- `world/city.ts`：`City` 加 `population`；新增 `gainLoyalty`（民忠回升，钳 [0,100]）、`addPopulation`。城级不变量收敛处。
- `economy/patrol.ts`：出巡规则——`canPatrol`/`patrol`（即时、占人、消费 RNG）。
- `economy/banquet.ts`：宴请规则——`canBanquet`/`banquet`（即时、不占人、君主跳忠诚）。
- `economy/move.ts`：移动规则——`canMove`/`move`（入队）/`executeMove`（月末改 cityId，占人例外）。
- `economy/transport.ts`：输送规则——`canTransport`/`transport`（入队+即时扣减）/`executeTransport`（月末 80/20 + RNG）。
- `economy/trade.ts`：交易规则——`canTrade`/`trade`（买/卖即时兑换、占人）。
- `game-state.ts`：`PendingCommand` 并集加 move/transport 分支。
- `game.ts`：5 个 Action 的校验/变更分派。
- `turn/pending.ts`：月末分派加 move/transport（非 campaign 趟）。
- `world/fixture.ts`：播种 `population`。
- 依赖方向：`economy/* → {world, shared}`；`turn/pending → economy`；`game → economy`。无新增循环。

## 要测的行为

- [ ] `canPatrol` 拒绝：无在任武将 / 本城金 < 50 / 体力 < 8。
- [ ] `patrol`：民忠 `+=randInt(1,4)`（封顶 100）、人口 +100、扣体力 8、扣城金 50、busy=true、RNG 推进；不入队；非法 no-op。民忠原已 100 时不超顶。
- [ ] `gainLoyalty`/`addPopulation`：钳 [0,100] / 累加，不碰其它字段。
- [ ] `canBanquet` 拒绝：目标 busy 或俘虏 / 本城金 < 100。
- [ ] `banquet`：扣城金 100、目标体力 +50（封顶 100）、非君主忠诚 +1（封顶 100）、君主忠诚仍 100；busy 不变、不入队、RNG 不变；非法 no-op。
- [ ] `canMove` 拒绝：目标 = 本城 / 目标非己方城 / 目标不存在 / 武将 busy 或俘虏。
- [ ] `move`：busy=true、入队 move；不扣体力/金、目标城/武将 cityId 不变；非法 no-op。`executeMove`：officer.cityId=目标城。
- [ ] `canTransport` 拒绝：体力 < 8 / 目标非己方城或本城 / food>城粮 或 gold>城金 或 troops>后备兵 / 负数 / 非整数。
- [ ] `transport` 下令：扣体力 8、出发城粮/金/后备兵立即扣减、busy=true、入队 transport；RNG 不变；非法 no-op。
- [ ] `executeTransport` 送达（命中 80%）：目标城 +food/+gold/+后备兵；失败（20%）：目标城不变、资源永损；两种分支均推进 RNG；按固定 seed 可复现命中/失败。
- [ ] `canTrade` 拒绝：体力 < 12 / buy 时 amount > floor(金/5) / sell 时 amount > 城粮 / 负数 / 非整数。
- [ ] `trade` buy：粮 +=amount、金 -=amount×5；sell：粮 -=amount、金 +=amount×2；扣体力 12、busy=true；不入队、RNG 不变；非法 no-op。
- [ ] 月末顺序：move/transport 在第一趟（非 campaign）按入队序执行，先于 campaign、先于 settle；执行后队列清空。
- [ ] 占人月末回城：patrol/move/transport/trade 执行人 busy→false（move 落在目标城、transport/patrol/trade 在原城）；banquet 目标 busy 始终不变。
- [ ] 既有指令与循环（develop/recruit/allocate/plunder/scout/campaign/reward/confiscate/settle/endMonth/跨年）不回归。
- [ ] 确定性：相同 seed + 相同动作序列结果一致（端到端 game.test）。

## 新建文件

- `src/core/economy/patrol.ts` + `patrol.test.ts`
- `src/core/economy/banquet.ts` + `banquet.test.ts`
- `src/core/economy/move.ts` + `move.test.ts`
- `src/core/economy/transport.ts` + `transport.test.ts`
- `src/core/economy/trade.ts` + `trade.test.ts`

## 修改文件

- `src/core/shared/config.ts`：加 5 个扁平成本 + 默认值。
- `src/core/world/city.ts`：`City` 加 `population`；加 `gainLoyalty`/`addPopulation`/`CITY_LOYALTY_MAX`。
- `src/core/world/fixture.ts`：播种 `population`。
- `src/core/game-state.ts`：`PendingCommand` 加 move/transport。
- `src/core/game.ts`：`Action` 加 5 条；`canApply/apply` 分派。
- `src/core/turn/pending.ts`：分派加 move/transport（非 campaign 趟）。
- 既有 `*.test.ts` / fixture 构造：补 `population` 字段使编译通过。

## 任务清单

- [x] config + city（`population` 字段、`gainLoyalty`/`addPopulation`/`CITY_LOYALTY_MAX`）+ fixture 播种；既有测试编译通过、保持绿。
- [x] economy/patrol：`canPatrol`/`patrol`（红绿，含 RNG/封顶/no-op）+ 接 game `patrol` Action。
- [x] economy/banquet：`canBanquet`/`banquet`（红绿，含君主跳忠诚/不占人）+ 接 game `banquet`。
- [x] economy/trade：`canTrade`/`trade`（红绿，买/卖上限/no-op）+ 接 game `trade`。
- [x] game-state PendingCommand 加 move/transport；economy/move：`canMove`/`move`/`executeMove`（红绿）+ 接 game + turn/pending。
- [x] economy/transport：`canTransport`/`transport`/`executeTransport`（红绿，80/20 + RNG + 即时扣减）+ 接 game + turn/pending。
- [x] 端到端：endMonth 整段推进（move 落目标城、transport 送达/永损、月末顺序、可复现、既有流程不回归）。

## TDD：是

core 全程红绿循环（CONSTITUTION 默认）；UI/store（出巡入口、宴请目标选择、移动选城、输送多步表单、交易买卖切换）不在本切片。

## 质量自检

- 接口最小自解释：5 条均沿用 `can*`/`*`（+ 月末 `execute*`）既有签名约定，officerId 作用城派生自 `officer.cityId`。✅
- 模块深、职责单一：每指令一文件，城级不变量（民忠回升/人口）收敛 `city.ts`；无 god 模块。✅
- 低改动放大：月末类只新增两个 PendingCommand 分支 + 两个 `execute*` + `turn/pending` 两分派，不动 busy/两趟逻辑/既有指令。✅
- config 取舍依 CONSTITUTION：扁平成本入 config（逐指令独立 key）；随机幅度/转化率/概率/量纲上限内联。✅
- YAGNI：不抽指令基类；唯一越界是 `population`（用户明确要、记风险）。✅
- 数据模型：移动/输送队列项只存必要真输入；占人仍 `busy`（与队列不同事实）；俘虏仍派生。✅（`population` 为无消费方字段——已知违反「无冗余/无消费方」，列风险待后续赋用）
- 复用既有：扣金/粮/兵、回城、忠诚增减、isCaptive、randInt 全复用，无重造。✅
- 测行为非实现：清单针对状态迁移与公式结果及顺序/可复现边界。✅
- 依赖方向健康：economy→world/shared、turn→economy，无循环；UI 不涉及。✅

## 决策升级

- **架构红线（升级 `AGENTS.md`）**：占人例外再添一类——「移动」月末由 `executeMove` 改写 `officer.cityId` 落到目标己方城、不回出发城（与出征同构，turn 层无特例）；`pendingCommands` 非 campaign 趟新增 move/transport。
- **术语（已于 spec-prd 入 `CONTEXT.md`）**：出巡/宴请/移动/输送/交易/人口；本阶段补充人口为「展示状态」语义。

## 风险 / 待定

- **人口无消费方**：本切片纯展示，违反「无冗余状态/字段须有消费方」，经用户确认保留，待后续切片（征兵/收粮收税是否吃人口）再赋规则；届时 `population` 才进公式。
- **输送月末消费 RNG 的顺序**：与掠夺同在第一趟、按入队序，决定 RNG 推进序；端到端测以固定 seed 锁定命中/失败，保证可复现。
- **交易无城金上限**：sell 可无限堆金（PRD 决定不封顶）；若后续平衡需要再加全局上限（届时收税等加金路径一并处理）。
- **move/transport 目标城本月被占领/易主**（如同月先被出征夺走）：月末移动/输送在第一趟、出征在第二趟，故移动/输送先执行，基于当时归属；不做跨指令连锁特判，仅保证不崩——留边界。
- **归属校验**（只能调己方将/送己方城）属 store 派发口（注入 playerLordId），本切片 core 不做（actor-agnostic）。

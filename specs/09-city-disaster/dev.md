# city-disaster 开发文档

## 方案概述

两块互不耦合，经既有两个分派点接线：

- **治理指令（下令阶段）→ `economy/govern.ts`**：复用 `can<Cmd>`/`<cmd>` 两段范式（与出巡同构：占人 ✓、即时生效、消费 RNG、不入 `pendingCommands`）。经 `game.ts` 的 `Action` + `canApply/apply` 分派。
- **月末灾害生命周期 → `world/disaster.ts`**：导出单一 `runDisasters(state)`，内部三步——异常城破坏 → 正常城生成 → 异常城恢复（合为一趟按城遍历，见下）。由 `turn/end-month` 在「登场」之后、作为月末最后一步调用。

关键取舍：

- **灾害是城状态的自治月末事件，归 `world/`**（已与用户确认）。与 `economy/settle`（经营产出）、掠夺破坏（掠夺指令的延后效果）性质不同：它不挂在任何玩家指令上，且只读写 `City` 的状态/防灾值/资源字段。
- **破坏的逐字段变换收敛进 `world/city.ts`**（新增 `applyDisasterDamage`，与既有 `ravage` 并列）：城聚合自管字段与不变量；`disaster.ts` 只负责「掷骰决定灾种/是否恢复」的 RNG 编排，不直接拼 `City` 内部。
- **月末顺序纯追加**：`runDisasters` 接在 `runDebuts` 之后，不动 settle/回城/月份+1/登场 任一既有步骤（不破坏 6/10、3/6/9/12 税粮日历）。
- **单趟按城遍历、固定顺序**：破坏不耗 RNG（确定性百分比），仅生成/恢复耗 RNG。为锁可复现，按 `城 id 升序` 遍历，逐城按其当前状态走「破坏+恢复」或「生成」一个分支，线程化 `rng`（同 `runDebuts` 手法）。
- **治理成本入 config（扁平成本）**：`governStaminaCost`/`governGoldCost`；防灾随机幅度 `RandInt(1,4)` 为规则身份，内联 `govern.ts`。破坏百分比表、灾种/恢复判定阈值、防灾值上限 100 均规则身份，内联 `city.ts`/`disaster.ts`。

## 接口设计
> 仅签名，不含实现体。

### shared/config.ts（修改：新增 2 个扁平成本）
```ts
export interface GameConfig {
  // …既有…
  readonly governStaminaCost: number // 8
  readonly governGoldCost: number    // 50
}
```

### world/city.ts（修改：新增状态/防灾值字段 + 3 个聚合操作）
```ts
/** 防灾值量纲上限（百分制，固定值；规则身份，不入 config）。 */
export const DISASTER_PREVENTION_MAX = 100

/** 城市状态：正常 + 四种灾害。单值存储；异常=灾害四种之一。 */
export type CityStatus = 'normal' | 'famine' | 'drought' | 'flood' | 'riot'

export interface City {
  // …既有…
  /** 城市状态，初始 'normal'（fixture 播种）。 */
  readonly status: CityStatus
  /** 防灾值 [0, DISASTER_PREVENTION_MAX]；越高越不易发灾、越快从旱/水灾恢复。 */
  readonly disasterPrevention: number
}

/** 设城市状态（治理改 normal / 生成改灾种 / 恢复改 normal）。 */
export function setStatus(c: City, status: CityStatus): City
/** 防灾值回升，钳制 [0, DISASTER_PREVENTION_MAX]（治理用）。 */
export function raisePrevention(c: City, delta: number): City
/**
 * 按状态破坏：每项 new = floor(当前 × (1 − 百分比))，「减半」即 50% 情形。
 * 破坏表（规则身份，内联）：
 *   famine : 商业-5% 民忠-5% 后备兵减半 人口-25% 农业-5%
 *   drought: 粮-5% 后备兵-25% 人口-25% 农业-5%
 *   flood  : 粮-5% 商业-10% 金-10% 后备兵-25% 人口-25% 农业-5%
 *   riot   : 粮-5% 商业-5% 金-5% 民忠-10% 后备兵减半 农业-5%
 * normal 传入即原样返回（防御性，调用方只对异常城调用）。
 */
export function applyDisasterDamage(c: City, status: CityStatus): City
```
> `setStatus`/`raisePrevention`/`applyDisasterDamage` 均为纯函数、不耗 RNG。

### economy/govern.ts（新建·即时·占人·消费 RNG）
```ts
// 内联规则身份：GOVERN_PREVENTION_RAND_MIN=1, GOVERN_PREVENTION_RAND_MAX=4
export function canGovern(state: GameState, officerId: OfficerId, config: GameConfig): CommandCheck
// 即时：状态强制 normal、防灾 += randInt(1,4)（封顶 100）、扣体力 governStaminaCost、扣本城金 governGoldCost、busy=true、推进 RNG；不入队。非法 no-op。
export function govern(state: GameState, officerId: OfficerId, config: GameConfig): GameState
```
`canGovern` 校验（同 patrol 骨架）：武将存在、未占用、非俘虏 → 本城存在 → 本城金 ≥ `governGoldCost` → 体力 ≥ `governStaminaCost` → **非「`status==='normal'` 且 `disasterPrevention===100`」**（已满则禁止，避免浪费）。

### world/disaster.ts（新建·月末编排·消费 RNG）
```ts
/**
 * 月末灾害生命周期（turn/end-month 在登场后调用，月末最后一步）。
 * 按城 id 升序单趟遍历，逐城按当前状态分派、线程化 rng：
 *  - 异常城：applyDisasterDamage（破坏，不耗 RNG）→ 判恢复（见下）。
 *  - 正常城：判生成（见下）。
 * 生成（仅正常城）：R=randInt(0,99)；R ≤ 防灾值 → 无灾；
 *   否则灾种=randInt(0,4)：0 drought / 1 flood / 2 再 randInt(0,99)>民忠→riot 否则无事 / 3、4 无事。
 * 恢复（仅异常城，破坏之后）：
 *   famine → 粮食>0 即 normal（不耗 RNG）；
 *   drought/flood → randInt(0,99) < 防灾值 → normal；
 *   riot → randInt(0,99) < 民忠 → normal。
 * 含 AI 城；无归属空城跳过（当前模型城恒有归属）。确定性、可注入 RNG。
 */
export function runDisasters(state: GameState): GameState
```

### game.ts（修改：Action 增 1 条 govern）
```ts
export type Action =
  | /* …既有… */
  | { type: 'govern'; officerId: OfficerId } // 治理（占人，即时）
// canApply → canGovern；apply → govern。归属（己方）不在 core，留 store/AI 入口。
```
> 治理不入 `pendingCommands`，`PendingCommand` 并集**不改**。

### turn/end-month.ts（修改：末尾加 runDisasters）
```ts
// … 月份+1 → runDebuts(...) → runDisasters(后者结果) 作为返回值。
```

### world/fixture.ts（修改）
`createInitialState` 给每城补 `status: 'normal'`、`disasterPrevention: MOCK_DISASTER_PREVENTION`（统一 mock 值，如 50；不逐城配，凸显占位）。

## 模块职责
- `shared/config.ts`：新增 2 个治理扁平成本旋钮。
- `world/city.ts`：`City` 加 `status`/`disasterPrevention`；`CityStatus` 类型、`DISASTER_PREVENTION_MAX`；`setStatus`/`raisePrevention`/`applyDisasterDamage`（破坏表内联，城字段变换的唯一收敛处）。
- `economy/govern.ts`：治理规则——`canGovern`/`govern`（即时、占人、消费 RNG、含「已满禁令」）。
- `world/disaster.ts`：月末灾害生命周期——`runDisasters`（破坏+生成+恢复的 RNG 编排与按城遍历）。
- `game.ts`：`govern` Action 的校验/变更分派。
- `turn/end-month.ts`：月末顺序末尾追加 `runDisasters`。
- `world/fixture.ts`：播种 `status`/`disasterPrevention`。
- 依赖方向：`economy/govern → {world/city, world/queries?, shared}`；`world/disaster → {world/city, shared/rng}`；`turn/end-month → world/disaster`；`game → economy/govern`。无新增循环（`disaster` 属 world，不被 economy 依赖）。

## 要测的行为
- [ ] `canGovern` 拒绝：无在任武将 / 武将俘虏或 busy / 本城金 < 50 / 体力 < 8 / 「已正常且防灾=100」。
- [ ] `canGovern` 放行：异常城即使防灾=100 仍可下令（治理清灾）；正常城防灾<100 可下令（升防灾）。
- [ ] `govern`：状态→normal、防灾 += randInt(1,4)（封顶 100）、扣体力 8、扣城金 50、busy=true、RNG 推进；不入队；非法 no-op；执行人月末经既有 endMonth 回城。
- [ ] `setStatus`/`raisePrevention`：改对应字段、防灾钳 [0,100]，不碰其它字段。
- [ ] `applyDisasterDamage`：四种灾各按破坏表 `floor(当前×(1−百分比))`（减半=floor(/2)）扣对应字段、不动未列字段；`normal` 原样返回；不耗 RNG。
- [ ] `runDisasters` 破坏：仅异常城扣减，正常城资源不变。
- [ ] `runDisasters` 生成：正常城 `R ≤ 防灾` 无灾；`R > 防灾` 且灾种 0/1 → drought/flood；灾种 2 且 `r2 > 民忠` → riot，否则无事；3/4 无事。按固定 seed 可复现具体结果。
- [ ] `runDisasters` 恢复：famine 粮>0 → normal（粮=0 不恢复、不耗 RNG）；drought/flood `randInt<防灾` → normal；riot `randInt<民忠` → normal；阈值边界（=防灾/=民忠）按 `<` 不恢复。
- [ ] 同月异常城「先破坏后判恢复」：恢复判定读的是破坏后的民忠（如 riot -10% 后再判）。
- [ ] 遍历确定性：多城同 seed 下结果与 RNG 推进序固定（按城 id 升序）。
- [ ] 月末顺序：`runDisasters` 在 `runDebuts` 之后、为最后一步；收粮/收税日历（6/10、3/6/9/12）与既有测试不回归。
- [ ] 端到端（game.test）：含治理 + 跨月 endMonth，相同 seed + 动作序列结果一致；既有指令/循环不回归。

## 新建文件
- `src/core/economy/govern.ts` + `govern.test.ts`
- `src/core/world/disaster.ts` + `disaster.test.ts`

## 修改文件
- `src/core/shared/config.ts`：加 `governStaminaCost`/`governGoldCost` + 默认值。
- `src/core/world/city.ts`：`City` 加 `status`/`disasterPrevention`；加 `CityStatus`/`DISASTER_PREVENTION_MAX`/`setStatus`/`raisePrevention`/`applyDisasterDamage`。
- `src/core/world/fixture.ts`：播种 `status`/`disasterPrevention`（`MOCK_DISASTER_PREVENTION`）。
- `src/core/game.ts`：`Action` 加 `govern`；`canApply/apply` 分派。
- `src/core/turn/end-month.ts`：末尾追加 `runDisasters`。
- 既有 `*.test.ts` / fixture 内的 `City` 构造：补 `status`/`disasterPrevention` 使编译通过。

## 任务清单
- [x] config + city（`status`/`disasterPrevention` 字段、`CityStatus`/`DISASTER_PREVENTION_MAX`/`setStatus`/`raisePrevention`/`applyDisasterDamage`）+ fixture 播种；既有测试编译并保持绿。
- [x] economy/govern：`canGovern`/`govern`（红绿，含「已满禁令」/RNG/封顶/no-op）+ 接 game `govern` Action。
- [x] world/disaster：`runDisasters` 破坏分支（红绿，四种灾破坏表）。
- [x] world/disaster：生成分支（红绿，防灾过筛→灾种→暴动看民忠，固定 seed 可复现）。
- [x] world/disaster：恢复分支（红绿，饥荒看粮、旱/水看防灾、暴动看民忠，边界 `<`）。
- [x] 接 turn/end-month（登场后调用 runDisasters）+ 端到端 endMonth 推进（月末顺序、税粮日历不回归、可复现、既有流程不回归）。

## 实现备注（spec-build）
- 端到端「6 月首次收粮/收税」既有测试因灾害会扰动经济（旱/水灾 -5% 粮等）而需隔离：在该测试起始把全城 `disasterPrevention=100`（永不发灾、无破坏），只验日历本身。
- `endMonth` 现会消费 RNG（`runDisasters` 生成/恢复掷骰），故旧测试名「整段推进确定性可复现（不耗 RNG）」已去掉「不耗 RNG」措辞；可复现断言（同 seed 两次相等）仍成立。
- `applyDisasterDamage` 破坏表以「剩余比例」乘子内联表达（减半=0.5），`new = floor(当前 × 比例)`，与 `ravage` 同向取整。

## TDD：是
core 全程红绿（CONSTITUTION 默认）；UI/store（治理入口按钮、城状态/防灾值展示）不在本切片。

## 质量自检
- 接口最小自解释：治理沿用 `can*`/`*` 既有约定，`officerId` 作用城派生自 `officer.cityId`；月末逻辑收成单一 `runDisasters(state)` 深接口。✅
- 模块深、职责单一：城字段变换（含破坏表）收敛 `city.ts`，RNG 编排收敛 `disaster.ts`，治理下令收敛 `govern.ts`；无 god 模块。✅
- 低改动放大：月末只在 `end-month` 追加一行、`game` 加一条 Action；不动 `pendingCommands`/两趟逻辑/settle/既有指令。新增灾种只动 `CityStatus` + `applyDisasterDamage` + 生成表三处，集中。✅
- config 取舍依 CONSTITUTION：治理扁平成本入 config；破坏百分比/灾种与恢复阈值/防灾上限内联（规则身份）。✅
- YAGNI：不抽「指令基类」、不抽「灾害基类」；防灾值统一 mock 播种、不提前做逐城调参表。✅
- 数据模型无冗余：状态/防灾值为不可派生的城自治真相，必存；俘虏/在任仍派生，不受影响。✅
- 复用既有：扣金/体力、setBusy、randInt、回城、isCaptive 全复用；破坏与 `ravage` 同位同风格。✅
- 依赖方向健康：disaster 属 world、不被 economy 依赖；turn→world/disaster；无循环；UI 不涉及。✅

## 决策升级
- **架构红线（升级 `AGENTS.md`）**：
  - 月末固定顺序扩展为 `pendingCommands → settle → 回城+体力 → 月份+1 → 登场 → 灾害（runDisasters）`；灾害为**纯追加**最后一步，不挪动既有步骤、不改税粮日历。
  - 新增上下文归属口径：**城状态自治月末事件归 `world/`**（与「掠夺破坏/收粮收税月末执行就近留 `economy/`」并存）——判据为「是否挂在某条玩家指令的延后效果上」：是→economy，否（城状态自治）→world。
- **术语（已于 spec-prd 入 `CONTEXT.md`）**：城市状态/灾害状态、防灾值、治理、灾害破坏结算/生成/恢复。

## 风险 / 待定
- **fixture 初始防灾值**：统一 mock（建议 50），未逐城配；平衡阶段再调（属领域数据/城属性，非 config）。
- **遍历顺序**：按城 id 升序锁 RNG 序；若未来引入「灾害先后影响相邻城」等跨城联动再议（当前无）。
- **「空城」口径**：当前每城恒有归属，实际全判；未来若有无归属城按「跳过」。
- **AI 不主动治理**：AI 城同样吃破坏/生成/恢复，但不会自救——本切片可接受，AI 经营策略留后续。

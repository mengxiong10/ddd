# plunder-scout 开发文档

## 方案概述
延续 `01`/`02` 既有架构：纯函数 `apply(state, action, config)`、可变态收敛在 `GameState`、不可变数值收敛在 `GameConfig`、领域服务「校验 `can*` 与变更 `*` 分离」、占人沿用 `Officer.busy`。本切片新增两条占人指令并引入**月末待执行队列**：

- **侦察 scout**：占人、**效果即时**（扣本城金/体力 + busy；"弹目标城详情面板"是 UI 行为，读现有目标城状态即可）。不入队，月末仅由既有 `endMonth` 回城。
- **掠夺 plunder**：占人、**效果延到月末**。下令仅扣体力 + busy + 入队；月末（先于 `settle`）执行破坏（农业/商业/民忠减半）+ 收益（粮/金）。

关键取舍：

- **队列做成通用 typed `pendingCommands`，而非掠夺专用**：用户明确后续会有多条「月末执行」指令，故队列项是带 `type` 的判别式并集，由 `turn` 层按 `type` 分派（与 `game.apply` 同构）。属"已知将来需求"，非投机抽象。
- **占人仍用 `busy`，不由队列推导**：`busy` 是横切**所有**占人指令的占用真相；`pendingCommands` 只装「效果延后」的指令（当前仅掠夺）。二者是不同事实（占用 vs 待执行效果），掠夺者恰好两者皆是，但不是同一事实双存——故不违反单一真相源。这样 `develop/recruit/queries.officersInCity/endMonth` 既有占人逻辑零改动、零回归。（若未来要把占用也并进队列、取消 `busy`，是另一次重构。）
- **掠夺破坏 = 城级降级**：减半作用于「城」属性，做成 `city.ravage` 聚合操作（含 `≥0` 不变量、`÷2` 内联）；**收益 = 经营转化**（智+武 → 粮/金），系数内联在 `plunder.ts`。破坏与收益分属城级/经营两层，分置。
- **月末顺序唯一归 `turn`**：在 `endMonth` 的 `settle` 之前插入 `runPendingCommands`；这是唯一知道「月末先执行待执行指令」的地方。
- **掠夺结果与执行顺序无关**：减半（作用农/商/民忠）与加法（作用粮/金）落在不相交字段，多条/不同序结果一致；队列有序仅为确定性与可读性。

## 接口设计
> 仅签名，不含实现体。

### game-state.ts（修改：新增队列）
```ts
/** 效果延到月末执行的指令项；按 type 分派（turn 层）。后续新增月末指令在此并集追加。 */
export type PendingCommand =
  | { readonly type: 'plunder'; readonly officerId: OfficerId } // 掠夺：本城=officer.cityId（静态，不另存）

export interface GameState {
  // ...既有: year/month/playerLordId/cities/officers/rng...
  /** 本月待月末执行的指令，按下令顺序；月末 runPendingCommands 执行后清空。仅「效果延后」指令入队。 */
  readonly pendingCommands: readonly PendingCommand[]
}
```
> 队列项只存 `officerId`：掠夺目标 = 执行人本城，本切片武将不跨城移动，`cityId` 由 `officer.cityId` 派生，不另存（单一真相源）。

### shared/config.ts（修改：新增扁平成本）
config 只放平衡旋钮（扁平成本/门槛）；公式系数与减半除数属规则身份，内联到领域模块。
```ts
export interface GameConfig {
  // ...既有...
  readonly plunderStaminaCost: number // 12（掠夺扣体力，门槛同值）
  readonly scoutStaminaCost: number   // 10（侦察扣体力，门槛同值）
  readonly scoutGoldCost: number      // 20（侦察扣本城金，门槛同值）
}
```
不进 config（内联规则身份）：掠夺收益系数 `粮 ×5`、`金 ×2`（`plunder.ts`）；破坏减半除数 `÷2`（`city.ts` 的 `ravage`）。

### world/city.ts（修改：新增破坏聚合操作）
```ts
/** 掠夺破坏：农业/商业/民忠各 floor(÷2)（÷2 为内联规则身份）。不变量：结果 ≥ 0（floor 于非负即保证），不超原上限。 */
export function ravage(c: City): City
```

### economy/plunder.ts（新建）
```ts
/** 掠夺收益转化率（规则身份，内联，不入 config）：power = 智力 + 武力；粮 += power×5、金 += power×2。 */
// const PLUNDER_FOOD_PER_POWER = 5, PLUNDER_GOLD_PER_POWER = 2

export function canPlunder(
  state: GameState, cityId: CityId, officerId: OfficerId, config: GameConfig,
): CommandCheck
// 下令即时：扣体力 config.plunderStaminaCost、officer busy、入队 {type:'plunder', officerId}；不改城、不动 RNG。非法 no-op。
export function plunder(
  state: GameState, cityId: CityId, officerId: OfficerId, config: GameConfig,
): GameState
// 月末单条执行（供 turn 分派）：本城 = officer.cityId；ravage(本城) + 粮 += power×5 + 金 += power×2。
export function executePlunder(state: GameState, officerId: OfficerId): GameState
```
`canPlunder` 校验：本城/武将存在 → 武将在本城且未占用 → 体力 ≥ `plunderStaminaCost`。

### economy/scout.ts（新建）
```ts
export function canScout(
  state: GameState, cityId: CityId, officerId: OfficerId, targetCityId: CityId, config: GameConfig,
): CommandCheck
// 即时：扣体力 config.scoutStaminaCost、扣本城金 config.scoutGoldCost、officer busy；不入队、不动 RNG。
// 「弹目标城详情面板」由 UI 在成功 apply 后读取 targetCity 渲染，core 无额外状态/返回。
export function scout(
  state: GameState, cityId: CityId, officerId: OfficerId, targetCityId: CityId, config: GameConfig,
): GameState
```
`canScout` 校验：本城/武将存在 → 武将在本城且未占用 → 本城金 ≥ `scoutGoldCost` → 体力 ≥ `scoutStaminaCost` → 目标城存在且 `target.lordId !== officer.lordId`（非己方，已涵盖「非本城」）。

### turn/pending.ts（新建）
```ts
/** 月末按 type 分派执行 pendingCommands（与 game.apply 同构），执行后清空队列。turn 层编排，不含领域规则。 */
export function runPendingCommands(state: GameState, config: GameConfig): GameState
```

### turn/end-month.ts（修改：插入待执行步骤）
```ts
// 新顺序：aiTakeTurn → runPendingCommands（待执行指令，先于结算）→ settle → 回城(busy=false)+体力恢复 → 月份+1
export function endMonth(state: GameState, config: GameConfig): GameState
```

### game.ts（修改：新增两个 Action）
```ts
export type Action =
  | { type: 'reclaim'; cityId: CityId; officerId: OfficerId }
  | { type: 'commerce'; cityId: CityId; officerId: OfficerId }
  | { type: 'recruit'; cityId: CityId; officerId: OfficerId; amount: number }
  | { type: 'allocate'; cityId: CityId; officerId: OfficerId; amount: number }
  | { type: 'plunder'; cityId: CityId; officerId: OfficerId }                  // 掠夺（占人，月末执行）
  | { type: 'scout'; cityId: CityId; officerId: OfficerId; targetCityId: CityId } // 侦察（占人，即时）
  | { type: 'endMonth' }
// canApply/apply 各加 plunder/scout 分派；签名不变。
```

### world/fixture.ts（修改）
`createInitialState` 初始化 `pendingCommands: []`。

## 模块职责
- `game-state.ts`：根状态 + `PendingCommand` 并集（队列项形状）。边界：只定义状态形状，不含执行逻辑。
- `shared/config.ts`：新增掠夺/侦察扁平成本。只放数值。
- `world/city.ts`：新增 `ravage`（城被掠夺的降级转移，含 `÷2` 与 `≥0` 不变量）。
- `economy/plunder.ts`：掠夺规则——`canPlunder`/`plunder`（入队）/`executePlunder`（月末破坏+收益）。收益系数内联于此。
- `economy/scout.ts`：侦察规则——`canScout`/`scout`（即时扣减+占人）。
- `turn/pending.ts`：月末待执行队列的 type 分派器 + 清空。turn 层编排，委派 economy，不含规则。
- `turn/end-month.ts`：月末顺序唯一归处，插入 `runPendingCommands`（settle 之前）。
- `game.ts`：新增 plunder/scout 两个 Action 的校验/变更分派。
- 依赖方向：`economy/{plunder,scout} → {world, shared}`；`turn/pending → economy`；`turn/end-month → {ai, turn/pending, economy/settle, world}`；`game → economy`。无新增循环。

## 要测的行为
- [x] `canPlunder` 拒绝：本城无在任武将 / 执行人体力 < 12，各返回 ok=false 与 reason。
- [x] `plunder`：扣体力 12、busy=true、`pendingCommands` 追加 `{type:'plunder',officerId}`；本城农/商/民忠/粮/金**不变**；RNG 不变；非法 no-op。
- [x] `ravage`：农业/商业/民忠各 `floor(/2)`、夹 `≥0`；不影响粮/金。
- [x] `executePlunder`：本城被 ravage + 粮 += (智+武)×5 + 金 += (智+武)×2（作用于 officer.cityId）。
- [x] 同城多条掠夺：月末连续减半（`floor(floor(a/2)/2)`）、收益累加；断言结果与下令顺序无关。
- [x] `runPendingCommands` 执行后 `pendingCommands=[]`，不跨月残留。
- [x] 月末顺序：掠夺**先于** `settle`——在收粮月(6/10)或收税月(3/6/9/12)掠夺，本城当月收粮/收税按减半后的农业/商业结算。
- [x] `canScout` 拒绝：本城金 < 20 / 无在任武将 / 体力 < 10 / 目标城不存在 / 目标城 `lordId == 执行人 lordId`（含本城）。
- [x] `scout`：扣体力 10、扣本城金 20、busy=true；不入队、RNG 不变；非法 no-op。
- [x] 占人月末回城：plunder/scout 的执行人经 `endMonth` 后 busy=false。
- [x] 既有 `develop/recruit/allocate/settle/endMonth` 行为不回归（新字段 `pendingCommands` 默认 `[]`）。
- [x] 确定性：相同 seed + 相同动作序列，结果一致（既有 game.test 端到端覆盖）。

## 新建文件
- `src/core/economy/plunder.ts`：掠夺领域服务（can/plunder/executePlunder）。
- `src/core/economy/scout.ts`：侦察领域服务（can/scout）。
- `src/core/turn/pending.ts`：月末待执行队列 type 分派器。
- `src/core/economy/plunder.test.ts`、`src/core/economy/scout.test.ts`、`src/core/turn/pending.test.ts`（pending 也可并入 end-month.test）。

## 修改文件
- `src/core/game-state.ts`：新增 `PendingCommand` 并集与 `pendingCommands` 字段。
- `src/core/shared/config.ts`：新增 `plunderStaminaCost/scoutStaminaCost/scoutGoldCost` + 默认值。
- `src/core/world/city.ts`：新增 `ravage`。
- `src/core/world/fixture.ts`：初始化 `pendingCommands: []`。
- `src/core/turn/end-month.ts`：`settle` 前插入 `runPendingCommands`。
- `src/core/game.ts`：`Action` 新增 plunder/scout；`canApply`/`apply` 分派。

## 任务清单
- [x] game-state + fixture：加 `PendingCommand`/`pendingCommands` 字段并初始化 `[]`（确保 01/02 既有测试仍绿）。
- [x] config：加掠夺/侦察三项成本 + 默认值。
- [x] world/city：`ravage`（红绿覆盖减半/夹取/不碰粮金）。
- [x] economy/plunder：`canPlunder` + `plunder`（入队/扣体力/busy/不改城/no-op）+ `executePlunder`（破坏+收益）。
- [x] turn/pending + end-month：`runPendingCommands` 按 type 分派 + 清空，接入月末顺序（pending→settle）。
- [x] economy/scout：`canScout` + `scout`（目标非己方校验/扣金扣体力/busy/no-op）。
- [x] game：接入 plunder/scout 两个 Action；端到端确定性测试（掠夺→月末破坏+收益、收粮月掠夺削当月产出、侦察占人→月末回城）。

## TDD：是
core 全程红绿循环（CONSTITUTION 默认）；UI/store（含侦察面板）不在本切片。

## 质量自检
- 接口最小自解释：`can*`/`*` 沿用既有约定；破坏（`ravage`）与收益（`executePlunder`）、即时（`scout`）各自单一职责的纯函数。✅
- 模块深、职责单一：plunder/scout 各独立；月末分派归 `turn/pending`；无 god 模块。✅
- 低改动放大：队列做成 typed `pendingCommands` + `turn` 层 type 分派，后续新增「月末执行」指令只加一个 type 分支 + 一个 `executeX`，不动 `busy`/既有指令。✅
- config 取舍依 CONSTITUTION：扁平成本（plunder/scout 体力、侦察金）入 config；收益系数 ×5/×2、减半 ÷2 内联。✅
- 无投机抽象：队列泛化由「已知后续多条月末指令」驱动（用户明示），非 YAGNI 反例；未取消 `busy` 以免大改无收益。✅
- 数据模型无冗余：队列项只存 `officerId`，`cityId` 派生自 `officer.cityId`；`busy` 与队列是不同事实（占用 vs 待执行效果），非双存。✅
- 复用既有：占人/回城复用 `busy`+`endMonth`；扣金/体力/加粮加金复用 city/officer 既有聚合操作。✅
- 测行为非实现：清单针对状态迁移与公式结果（含「顺序无关」「先于 settle」边界）。✅
- 依赖方向健康：economy→world/shared、turn→economy，无循环；UI 不涉及。✅

## 决策升级
- **架构红线（升级 `AGENTS.md`）**：占人仍用 `Officer.busy`；「效果延到月末」的指令进 `GameState.pendingCommands`（带 `type`），由 `turn` 层按 `type` 分派执行；月末顺序固定为 `pending → settle → 回城/体力 → 月份+1`。这是约束后续所有「月末执行类」指令的跨功能约定。
- **术语（已在 spec-prd 入 `CONTEXT.md`）**：掠夺/侦察/效果时机/月末待执行队列；本阶段把「队列」明确为 typed `pendingCommands` + type 分派。

## 风险 / 待定
- `pendingCommands` 当前仅 `plunder` 一种 type，但用户明确后续会增多，故采判别式并集（已知将来需求，非投机）。
- 破坏除数 `÷2` 置于 `city.ravage`、收益系数置于 `plunder.ts`：破坏是城级降级、收益是经营转化，分属两层；若未来破坏规则多样化再抽。
- `scout` 暂置 `economy/`，其本质偏情报/军事；待 `military`/intel 上下文出现再迁。
- 侦察面板字段/形态属 UI，留后续 UI 切片；core 仅保证目标城状态可读、校验「非己方」。
- 民忠自此可被掠夺减半（首次变动态），无自然回升，留后续切片。

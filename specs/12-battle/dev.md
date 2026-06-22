# battle 战斗系统 开发文档

## 方案概述

把出征的月末同步速算（`military/campaign.executeCampaign`）升级为**可暂停的交互式逐日战棋**。核心三处设计取舍：

- **可重入月末**：`endMonth` 跑完「非 campaign 待执行指令」后逐条处理 campaign——遇到**玩家参与**的 campaign 就**挂起**成 `GameState.activeBattle` 并提前返回；该 campaign 留在队列里充当「续战清单」。战斗逐 battle-action 推进，分胜负后由 `resumeMonth` 写回并**续跑**（还有 campaign → 开下一场；没有 → 跑收粮/回城/月份+1/登场/灾害的尾段）。无需额外续点标记：剩余 campaign 队列 + 「是否在 campaign 阶段」隐含了续点。
- **战斗是 core 状态机，不是 UI 循环**（项目仍无 store/ui）：「玩家逐日操作」= 一组离散 `BattleAction` 经 `apply` 作用到 `activeBattle`，本切片用 vitest 驱动、未来由 UI 驱动。
- **单位快照、分胜负才写回**：开战时把参战武将快照成 `BattleUnit`（位置/当前兵力/经验/等级/是否已行动/是否击溃），战中只动快照；`concludeBattle` 才把兵力/经验/等级写回 `Officer`，占城/俘虏/重选君主复用 04 抽出的 `resolveCampaignOutcome`。

**无环依赖**：`military/battle` 不 import `turn`；`turn/end-month` import `military`（与既有 `pending → executeCampaign` 同向）。battle reducer 只推进战斗、置 `outcome`；写回+续月末由 `turn.resumeMonth`（调 `military.concludeBattle` + `military.resolveCampaignOutcome`）负责。

**确定性**：战斗全程不耗对局 RNG（公式全 floor、对手方本切片不行动）。本切片实战仅「玩家进攻」会发生；防守模式引擎结构支持、但因 AI 不主动出征不可达。

## 接口设计

### shared/position.ts（新建·值对象）

```ts
export interface Position {
  readonly x: number
  readonly y: number
}
export function samePos(a: Position, b: Position): boolean
export function manhattan(a: Position, b: Position): number
```

### military/battle-map.ts（新建·地形值对象 + 纯规则表）

```ts
export type Terrain =
  | 'grass'
  | 'plain'
  | 'mountain'
  | 'forest'
  | 'village'
  | 'city'
  | 'camp'
  | 'river'

export type MapId = string

// 行主序地形数组（length === width*height）；城池格与双方出生点均运行时派生
export interface BattleMap {
  readonly id: MapId
  readonly width: number // 32
  readonly height: number // 32
  readonly tiles: readonly Terrain[]
}

export type AttackDirection =
  | 'north'
  | 'northEast'
  | 'east'
  | 'southEast'
  | 'south'
  | 'southWest'
  | 'west'
  | 'northWest'

// 移动消耗 [兵种][地形]（规则身份，内联常量；§6.5.2）
export const MOVE_COST: Record<TroopType, Record<Terrain, number>>
// 地形战力折减档 [兵种][地形]，值 0/1/2/3 = /1 /2 /4 /8（§6.5.3）
export const REDUCTION_TIER: Record<TroopType, Record<Terrain, number>>
// 地形防御系数 [地形]（§6.5.4），用整数百分比避免浮点：grass100 plain100 mountain130 forest115 village110 city150 camp120 river80
export const DEFENSE_COEF_PCT: Record<Terrain, number>

export const GRID_SIZE = 32 // 棋盘 32×32（与总纲一致）
export const MAX_MOVEMENT = 8 // 移动力上限（量纲上限）
export const MAX_DAYS = 30 // 日循环上限

export function inBounds(map: BattleMap, p: Position): boolean
export function terrainAt(map: BattleMap, p: Position): Terrain
export function isCityTile(map: BattleMap, p: Position): boolean
export function cityTile(map: BattleMap): Position
// 返回出发城相对目标城的方向，即攻方进入战场的方向
export function attackDirection(source: Position, target: Position): AttackDirection
// 复刻原版 dFgtIntPos：攻方按八方向取边缘基准，守方按 city 地形取基准
export function attackerSpawns(map: BattleMap, direction: AttackDirection): readonly Position[]
export function defenderSpawns(map: BattleMap): readonly Position[]
```

### military/battle-combat.ts（新建·纯战斗数学）

```ts
// 兵种攻/防系数（§6.3.2，用整数百分比；attack: 骑100 步80 弓90 水80 极130 玄40；defense: 骑70 步120 弓100 水110 极120 玄60）
export const TROOP_ATTACK_PCT: Record<TroopType, number>
export const TROOP_DEFENSE_PCT: Record<TroopType, number>
// 兵种相克倍率 [攻][防]（§6.3.3，整数百分比）
export const COUNTER_PCT: Record<TroopType, Record<TroopType, number>>
// 默认普攻范围掩码（相对中心偏移；§6.3.4）：十字(骑/水/玄) / 周身8(步/极) / 散点(弓)
export const ATTACK_MASK: Record<TroopType, readonly Position[]>

// 基础攻击/防御（地形折减前；§6.3.1）。force/intel 取有效值，troopType 取有效兵种。
export function baseAttack(force: number, level: number, troopType: TroopType): number // floor(force*(level+10)*coef)
export function baseDefense(intel: number, level: number, troopType: TroopType): number

// 地形修正后攻击力/防御力（§6.5.3~§6.5.4）
export function terrainAttack(base: number, tier: number): number // floor(base / 2^tier)
export function terrainDefense(base: number, tier: number, defCoefPct: number): number // floor(floor(base/2^tier) * pct/100)

// 单次普攻实际扣兵（§6.7.1）：floor(atk/def * floor(attackerTroops/8))，*相克 +10，min 目标当前兵力
export function attackDamage(
  atkPower: number,
  defPower: number,
  attackerTroops: number,
  counterPct: number,
  targetTroops: number
): number

// 经验（§6.7.4）：含等级差加成 + 击溃额外经验；返回新增经验
export function experienceGain(
  troopDelta: number,
  attackerLevel: number,
  targetLevel: number,
  routed: boolean
): number
// 升级（§6.7.4）：经验≥100 扣100、等级+1，一次只升一级；返回 { level, experience }
export function applyLevelUp(
  level: number,
  experience: number
): { level: number; experience: number }

// 每日耗粮（§6.7.2）：floor(sqrt(本方未击溃单位兵力和)/3)
export function dailyFoodCost(sideTroops: number): number
```

### military/battle-movement.ts（新建·走位/攻击范围）

```ts
// 可达格（§6.6.4）：Dijkstra 按 MOVE_COST 累计，预算=单位移动力（officerMovement，封顶 8）；
// 存活单位占格不可进入；友方只挡最终落点不挡路径扩展；敌方四邻=接敌停步区，进入后剩余预算压到1、不可再穿越。
export function reachableTiles(
  state: GameState,
  battle: BattleState,
  officerId: OfficerId
): Position[]
// 普攻可击格（§6.6.5）：以单位当前/落点为中心套 ATTACK_MASK（装备可覆盖范围，留待装备覆盖落地），界内即返回
export function attackableTiles(
  battle: BattleState,
  map: BattleMap,
  from: Position,
  troopType: TroopType
): Position[]
```

### military/battle.ts（新建·战斗状态机）

```ts
export type BattleSide = 'player' | 'opponent'
export type BattleMode = 'attack' | 'defend' // 玩家进攻 / 玩家防守
export type BattleOutcome = 'playerWin' | 'playerLose'

export interface BattleUnit {
  readonly officerId: OfficerId
  readonly side: BattleSide
  readonly pos: Position
  readonly troops: number // 战中当前兵力（快照，可变）
  readonly experience: number // 快照，可变
  readonly level: number // 快照，可变
  readonly acted: boolean // 本日是否已行动
  readonly routed: boolean // 兵力归零 = 击溃
}

export interface BattleState {
  readonly mode: BattleMode
  readonly mapId: MapId
  readonly day: number // 当前天数（从 1 起）
  readonly units: Readonly<Record<OfficerId, BattleUnit>>
  readonly playerProvisions: number // 玩家方战场粮草
  readonly opponentProvisions: number // 对手方战场粮草
  readonly attackerCommanderId: OfficerId // 攻方主将 = 出征名单首位；开战定格；被击溃→攻方负
  readonly defenderCommanderId: OfficerId // 守方主将 = 太守（守方列首位）；开战定格；被击溃→守方负
  readonly outcome: BattleOutcome | null // null=进行中
  readonly targetCityId: CityId // 唯一持有的来源 campaign 信息
  // 攻方君主、攻/守参战名单均由 units 派生（不存）：攻方君主=攻方单位 Officer.lordId（整场不变）、
  //   名单=units.side；粮草已转入 playerProvisions/opponentProvisions（随军粮草不再单存）。
}

// 战斗专属 action（经 game.apply 的 {type:'battle', action} 包装分派）
export type BattleAction =
  | {
      type: 'act'
      officerId: OfficerId
      moveTo?: Position
      terminal: { kind: 'attack'; target: Position } | { kind: 'rest' }
    }
  | { type: 'endDay' }
  | { type: 'retreat' }

// 从一条玩家 campaign 初始化战斗：读目标城 battleMap、按攻守模式摆双方单位（≤10/方）、
// 算战场粮草（攻=provisions、守=目标城开战快照城粮）、day=1、outcome=null。
// 守方选取：太守（governorOf）领衔，其余按兵力降序（平局 id 升序）、限 10。
// 双主将：攻方主将=出征名单首位、守方主将=守方首位（即太守）。
export function initBattle(state: GameState, cmd: CampaignPending): BattleState

// 轻校验（供 canApply）：activeBattle 存在、未结束、该单位己方存活未行动、moveTo 可达、attack 目标在范围且有敌。
export function canBattle(state: GameState, action: BattleAction): CommandCheck

// 战斗 reducer（纯）：act=可选移动+(攻击/休息)，结束该单位本日行动并结算伤害/经验/升级/击溃；
// endDay=对手方行动(本切片 no-op)→双方扣当日粮草→day+1→刷新 acted→（天气/状态跳过）；
// retreat=玩家方失败。每步后跑 checkVictory 写 outcome。非法 no-op。
export function reduceBattle(state: GameState, action: BattleAction): GameState

// 胜负判定（§6.7.3）：返回 outcome 或 null。触发点（城池格/任一方主将击溃/全灭即时；撤退即时；粮草/30天在 endDay）。
// 任一方主将（攻方=出征首位、守方=太守）被击溃 → 该方负（按 mode 映射成 player/opponent）。
export function checkVictory(battle: BattleState, map: BattleMap): BattleOutcome | null

// 分胜负后写回（不 import turn）：把每单位 troops/experience/level 写回 Officer，
// 据 mode+outcome 求 attackerWins，调 resolveCampaignOutcome 完成占城/俘虏/重选君主，清空 activeBattle。
export function concludeBattle(state: GameState): GameState
```

### military/campaign.ts（修改·抽公用战后处理）

```ts
// 抽出：给定 attackerWins，移动攻方武将 cityId→目标城、胜则目标城 lordId→攻方且城粮 += provisions、
// 末了对攻/守君主各跑一次 resolveSuccession。战斗与速算共用。
export function resolveCampaignOutcome(
  state: GameState,
  officerIds: readonly OfficerId[],
  targetCityId: CityId,
  provisions: number,
  attackerWins: boolean
): GameState

// 速算 fallback（非玩家 campaign 用；本切片 AI 不出征故走不到）：比兵力总和→attackerWins→resolveCampaignOutcome
export function executeCampaign(state, officerIds, targetCityId, provisions): GameState
```

### game-state.ts（修改）

```ts
import type { BattleState } from './military/battle'
export interface GameState {
  // …既有字段…
  readonly activeBattle: BattleState | null // 非空=月末挂起在战斗中
}
```

### world/officer.ts（修改）

```ts
export interface Officer {
  // …既有字段…
  readonly experience: number // 经验，[0,100)，满 100 升级扣 100（fixture 播种）
}
```

### world/city.ts（修改）

```ts
export interface City {
  // …既有字段…
  readonly battleMapId: MapId // 该城对应的战斗地图（fixture 播种、模板复用）
}
```

### turn/end-month.ts（修改·可重入）

```ts
// endMonth：AI 下令 → 跑非 campaign 待执行 → advanceCampaigns（遇玩家 campaign 挂起 / 否则速算）→ 尾段
export function endMonth(state: GameState, config: GameConfig): GameState
// resumeMonth：战斗分胜负后调用——concludeBattle 写回 + 从队列移除该 campaign + 继续 advanceCampaigns/尾段
export function resumeMonth(state: GameState, config: GameConfig): GameState
// 内部：advanceCampaignsThenTail（首个 campaign 若玩家参与→设 activeBattle 返回；否则速算并出队，循环；无 campaign→尾段）
//       finishMonthTail（settle→回城+体力→月份+1→登场→灾害；清空队列）
```

### game.ts（修改）

```ts
export type Action =
  | /* …既有… */
  | { type: 'battle'; action: BattleAction }  // 战斗推进（不需 config）
  | { type: 'resumeMonth' }                   // 战斗结束后续跑月末（需 config）
// apply：'battle'→reduceBattle(state, a.action)；'resumeMonth'→resumeMonth(state, config)
// canApply：'battle'→canBattle；'resumeMonth'→{ok:true}；'endMonth' 在 activeBattle≠null 时返回 {ok:false}
```

## 模块职责

- `shared/position.ts`：格坐标值对象 + 纯助手；零依赖。
- `military/battle-map.ts`：地形枚举、`BattleMap`、三张地形表（移动/折减/防御）、棋盘/移动/天数上限常量、地图读取助手，以及原版八方向攻方/城池基准守方出生阵形的运行时计算；纯数据，不读 state。
- `military/battle-combat.ts`：兵种系数/相克表/普攻范围掩码 + 攻防/伤害/经验/升级/耗粮**纯公式**；不读 state、不依赖地图结构（入参传值）。
- `military/battle-movement.ts`：可达格（地形消耗 + 阻挡 + 接敌停步）与可击格；读 `BattleState`/`BattleMap` + `officerMovement`。
- `military/battle.ts`：`BattleState`/`BattleUnit`/`BattleAction` 类型、`initBattle`/`canBattle`/`reduceBattle`/`checkVictory`/`concludeBattle`；编排上面三个纯模块 + world（queries/effectiveOfficer/effectiveTroopType/succession）。不 import turn/game/economy。
- `military/campaign.ts`：抽 `resolveCampaignOutcome`（战斗与速算共用），`executeCampaign` 退为非玩家 fallback。
- `turn/end-month.ts`：唯一掌握月末顺序处；可重入 + `resumeMonth`。
- `turn/pending.ts`：拆出 `runNonCampaignPending`（执行并移除非 campaign 项）与「取首个 campaign / 判玩家参与 / 出队」助手，供 end-month 编排。
- `world/fixture.ts`：播种 `battleMaps` 注册表、各城 `battleMapId`、武将 `experience`。

## 要测的行为

- [ ] `battle-combat` 纯公式：baseAttack/baseDefense 按兵种系数；terrainAttack/Defense 按折减档(/1 /2 /4 /8)与防御系数；attackDamage = `floor(atk/def*floor(兵力/8))*相克+10` 且 ≤ 目标兵力。
- [ ] 经验：低/平/高等级差三档基础经验正确；击溃额外 24/16/8；applyLevelUp 满100升1级（一次一级、扣100）。
- [ ] `dailyFoodCost` = floor(sqrt(总兵力)/3)。
- [ ] `reachableTiles`：按兵种地形消耗算预算；存活单位挡格；友方不挡路径只挡落点；敌方四邻接敌停步区进入后压到1、不可穿越；上限 8。
- [ ] `attackableTiles`：三类兵种掩码（十字/周身/散点）正确、越界剔除。
- [ ] `battle-map`：`isCityTile` 直接读 `tiles`；攻击方向由出发城相对目标城的八方向派生；攻方按方向、守方按唯一 `city` 地形复刻原版 `dFgtIntPos` 生成各 10 个合法出生点。
- [ ] `initBattle`：≤10/方按运行时方向计算的出生点摆位；守方=太守领衔+其余兵力降序；攻方主将=出征首位、守方主将=太守；战场粮草攻=provisions/守=目标城快照城粮、day=1。
- [ ] `reduceBattle` act：移动+攻击结算扣兵/给经验/升级/置 acted；只移动+休息也置 acted；非法（越界/超范围/已行动/非己方）no-op。
- [ ] `reduceBattle` endDay：对手 no-op、双方扣当日粮草(≤当前)、day+1、刷新 acted。
- [ ] `checkVictory` 全表：任一方主将击溃（攻方主将=出征首位、守方主将=太守，按 mode 映射 player/opponent）/全灭/城池格（攻入=玩家进攻胜、守方城池被入=玩家防守败）/粮草=0（同日双归零按玩家败）/30天（进攻超时败、防守超时胜）/撤退败。
- [ ] `concludeBattle`：单位 troops/experience/level 写回 Officer；attackerWins 由 mode+outcome 推；占城/俘虏/重选君主与 04 一致（复用 resolveCampaignOutcome）；activeBattle 清空。
- [ ] `endMonth` 端到端：含玩家 campaign 时挂起为 activeBattle（不继续尾段）；`resumeMonth` 写回并续跑（多支 campaign 逐场、无则尾段）；无 campaign 的普通月与既有行为完全一致、可复现（战斗不耗 RNG）。
- [ ] 既有 04 速算行为经 `resolveCampaignOutcome` 重构后不回归。

## 新建文件

- `src/core/shared/position.ts`：格坐标值对象。
- `src/core/military/battle-map.ts`：地形/地图/地形表/常量/读取助手。
- `src/core/military/battle-combat.ts`：兵种系数/相克/掩码 + 攻防/伤害/经验/升级/耗粮纯公式。
- `src/core/military/battle-movement.ts`：可达格 + 可击格。
- `src/core/military/battle.ts`：战斗状态机（类型/init/can/reduce/checkVictory/conclude）。
- 对应 `*.test.ts`（同级）：`battle-map`/`battle-combat`/`battle-movement`/`battle` + `turn/end-month` 端到端补充。

## 修改文件

- `src/core/game-state.ts`：`GameState` 加 `activeBattle`（import `BattleState` 类型）。
- `src/core/game.ts`：`Action` 加 `battle`/`resumeMonth`；`apply`/`canApply` 分派；`endMonth` 在战斗中拒绝。
- `src/core/world/officer.ts`：`Officer` 加 `experience`。
- `src/core/world/city.ts`：`City` 加 `battleMapId`。
- `src/core/military/campaign.ts`：抽 `resolveCampaignOutcome`，`executeCampaign` 退为 fallback。
- `src/core/turn/end-month.ts`：可重入 + `resumeMonth`。
- `src/core/turn/pending.ts`：拆 `runNonCampaignPending` + campaign 取/判/出队助手。
- `src/core/world/fixture.ts`：播种 `battleMaps`、各城 `battleMapId`、武将 `experience`。
- 既有 `*.test.ts`：补 `City.battleMapId`、`Officer.experience`、`GameState.activeBattle` 构造字段。

## 任务清单

- [x] `shared/position.ts` + `military/battle-map.ts`（地形表/常量/读取，红绿）。
- [x] `military/battle-combat.ts` 全套纯公式（红绿，覆盖折减/相克/伤害/经验/升级/耗粮）。
- [x] `world/officer.ts` 加 `experience`、`world/city.ts` 加 `battleMapId`、`game-state.ts` 加 `activeBattle`、`fixture.ts` 播种，使既有测试与构造编译通过。
- [x] `military/battle-movement.ts` 可达格（地形+阻挡+接敌停步）+ 可击格（红绿）。
- [x] `military/campaign.ts` 抽 `resolveCampaignOutcome`、`executeCampaign` 退 fallback（红绿，04 不回归）。
- [x] `military/battle.ts` `initBattle`/`checkImmediateVictory`（红绿，全胜负表）。
- [x] `military/battle.ts` `reduceBattle`（act/endDay/retreat）+ `canBattle`（红绿）。
- [x] `military/battle.ts` `concludeBattle`（写回 + resolveCampaignOutcome，红绿）。
- [x] `turn/end-month.ts` 可重入 + `resumeMonth`、`turn/pending.ts` 拆 `runNonCampaignPending`（红绿）。
- [x] `game.ts` 接 `battle`/`resumeMonth`、`endMonth` 战斗中拒绝；`game.test` 端到端（出征→挂起→撤退→续月末）。

全量回归：409 tests 绿、typecheck 清。

## TDD：是

## 实现偏差（与 dev 设计的小调整，已落地）

- **地图数据放 `military/battle-map.ts` 模块常量 `BATTLE_MAPS`**（程序化 `makeTemplateMap` 构造 32×32 模板），不进 `GameState`/存档（静态规则数据、避免快照膨胀）；`City.battleMapId` 用 `string`（仅地图键）而非引入 `MapId` 类型，**避免 `world → military` 反向依赖**。
- **`initBattle` 签名**用 `(state, officerIds, targetCityId, provisions)` 与 `executeCampaign` 同形，不引 `CampaignPending` 类型；`turn/end-month.advanceCampaigns` 从队列取 campaign 项传入。
- **双主将**：守方=目标城归属方在城武将「太守（`governorOf`）领衔、其余按兵力降序（平局 `id` 升序）」的首位；攻方=出征名单首位。两者开战定格存 `attackerCommanderId`/`defenderCommanderId`（不随减员漂移、不可事后按当前兵力重算），任一方主将击溃即该方负。
- **即时胜负**函数命名为 `checkImmediateVictory`（日界判定 `checkDayBoundaryVictory` 内联于 `advanceDay`）。

## 决策升级

- **架构红线（升级到 AGENTS.md）**：①「玩家参与的战斗 = `apply` 之上的交互式子对局：`endMonth` 可重入，遇玩家 campaign 挂起为 `GameState.activeBattle`、经离散 `BattleAction` 推进、`resumeMonth` 写回并续跑；战斗专属 action 经 `{type:'battle',action}` 单包装委派 `military/battle`，`military` 不反向 import `turn`。」②「战斗 core 确定性、不耗对局 RNG。」
- **总纲**：战棋规模 32×32、≤10/方已在 PRD 阶段更新 `CONSTITUTION.md`。
- **术语（已在 PRD 阶段写入 CONTEXT.md）**：战斗/战斗子状态/攻守模式·主将/战斗派生属性/战斗地图/地形/城池格/接敌停步区/战场粮草/经验·升级/击溃。

## 风险 / 待定

- **对手方静止**：本切片 `endDay` 对手方为 no-op，实战只有「玩家进攻」可达；AI 战斗行动与 AI 主动出征（→玩家防守可达）留后续切片，引擎结构已预留 `side='opponent'`/`mode='defend'`。
- **战后粮草口径沿用 04**：胜利并入**完整随军粮草**（非战场剩余），战场粮草仅服务「粮草=0」判负；独立战场粮草结转留 `08-aftermath`。
- **装备覆盖普攻范围/移动力**：`attackableTiles` 当前用兵种默认掩码；装备整体覆盖范围本切片先不接（11 已有移动力加成派生，`officerMovement` 直接用）。留待装备-战斗联动切片。
- **多支出征同月打同城**：逐场 `resumeMonth` 串行，每场基于当时状态（可能目标城已易主）；连锁仅保证不崩，沿用 04 边界。
- **`activeBattle` 进存档/快照**：交互中存档可恢复战斗，属可接受的状态膨胀。
- **`canBattle` vs reducer 防御**：canApply 轻校验 + reducer 对非法 no-op 双保险，避免 UI 误派发污染战斗态。
- **地图 fixture 体量**：32×32=1024 格 × 少量模板，手写用紧凑构造（如按地形填充 + 少量覆盖），具体布局/出生点/城池格留实现期定。

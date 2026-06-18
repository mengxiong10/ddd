# battle-skills 战斗技能 开发文档

## 方案概述

在 `12-battle` 的 `military/battle` 状态机上**纯增量**加技能：新增三个纯规则叶模块（`battle-weather` / `battle-status` / `battle-skill`），`battle.ts` 仅多编排「施法终结动作 + 每日开头刷天气/状态」。关键取舍：

- **三个深叶模块，零反向依赖**：技能/天气/状态全部纯函数、不读 state，`battle.ts` 编排时把值传进去（同 `battle-combat` 范式）。依赖方向 `battle → {battle-skill, battle-weather, battle-status, battle-movement, battle-combat, battle-map}`，叶子之间只单向 import 类型。
- **RNG 经 `state.rng` 线程化**（沿用 `disaster.ts` 范式 `randInt(rng)→[值,新rng]`）：`reduceBattle(state,action)` 本就持全量 state，施法成功率、每日刷天气、每日状态判定都读写 `state.rng`，无需改签名。这落实 PRD 对「战斗确定性红线」的收窄（无技能 12 子集仍确定）。
- **死亡并入 `status`（单一真相源）**：去掉 `BattleUnit.routed`，死亡即 `status==='dead'`（§6.6.2 把死亡也当一种状态）；既有 12 代码里所有 `u.routed` 改判 `u.status==='dead'`。击溃不变量仍是 troops===0 ↔ 'dead'。
- **`startDay` 统一日界**：抽一个共享的「每日开头」过程（查 30 天 → 刷天气 → 状态判定/石阵损兵 → 重置 acted → 胜负检查），第 1 天由 `turn` 装好单位后调用、之后每个 `endDay` 调用，避免天气/状态逻辑两处重复。
- **MP 只活在快照**：`BattleUnit.mp/maxMp` 开战由公式派生、`concludeBattle` 不写回（Officer 无 MP 字段），与「不建 HP 模型、扣兵不扣 HP」一致。
- **谍报/天变为无目标**：源文档矛盾（附录 A.31 谍报画了 ● 格，但 §6.4.1「目标=自身」、§6.4.5 谍报目标维度倍率全 0）按 §6.4.1 处理——二者无目标、不走选点、忽略掩码与目标维度倍率。

## 接口设计

### military/battle-weather.ts（新建·纯）

```ts
export type Weather = 'clear' | 'overcast' | 'wind' | 'rain' | 'hail' // 晴/阴/风/雨/雹
export const WEATHER_ORDER: readonly Weather[] // 倍率表第 0..4 维序：晴阴风雨雹
export function refreshWeather(rng: Rng): readonly [Weather, Rng] // 均匀 randInt(0,4)→WEATHER_ORDER
```

### military/battle-status.ts（新建·纯）

```ts
// 含死亡的全状态（死亡=唯一真相，troops===0 ↔ 'dead'）
export type BattleStatus = 'normal' | 'confused' | 'sealed' | 'rooted' | 'qimen' | 'stone' | 'dead'
export function canActWithStatus(s: BattleStatus): boolean // 混乱/石阵/死亡 → false
export function canCastWithStatus(s: BattleStatus): boolean // 禁咒/死亡 → false
export function stoneDamage(troops: number): number // 石阵每日损 = floor(troops/8)
// 每日开头判定（§6.6.2）：成功=randInt(0,59)<floor(有效智力/2)
//  混乱/禁咒/定身/石阵：成功→normal；奇门：失败→normal；normal/dead：不变（dead 跳过、不耗 rng）。返回新状态 + rng。
export function dailyStatusCheck(
  s: BattleStatus,
  effIntel: number,
  rng: Rng
): readonly [BattleStatus, Rng]
```

### military/battle-skill.ts（新建·纯·技能规则唯一收敛处）

```ts
export type SkillId = number // 1..30；本作纳入 27 个（去 21/26/28）

export interface SkillDef {
  readonly id: SkillId
  readonly name: string
  readonly target: 'enemy' | 'ally' | 'self'
  readonly mp: number
  readonly baseTroops: number // 兵力效果基数（伤害/恢复），0=无
  readonly baseFood: number // 破粮基数，0=无
  readonly status?: BattleStatus // 命中施加的状态（突袭=confused 等）
  readonly special?: 'weather' | 'intel' | 'siege' // 天变/谍报/围攻
  readonly weatherMul: readonly number[] // len5，WEATHER_ORDER 序
  readonly targetTerrainMul: readonly number[] // len8，TERRAIN_ORDER 序（§6.4.5 目标地形）
  readonly casterTerrainMul: readonly number[] // len8，TERRAIN_ORDER 序（施法者地形）
  readonly targetTroopMul: readonly number[] // len6，TROOP_ORDER 序（目标兵种）
}

export const TERRAIN_ORDER: readonly Terrain[] // 草地/平原/山地/森林/村庄/城池/营寨/河流
export const TROOP_ORDER: readonly TroopType[] // 骑/步/弓/水/极/玄
export const SKILL_DEFS: Record<SkillId, SkillDef> // 27 条，§6.4.1+§6.4.5 录入
export const RANGE_MASK: Record<SkillId, readonly Position[]> // 中心偏移、不含中心；self→[]；附录 A 录入

export const DEFAULT_SKILLS: Record<TroopType, readonly SkillId[]> // 各兵种默认技能（有序）
export const LORD_SKILLS: readonly SkillId[] // 君主技能=[30]

// MP（吃有效武力/智力）：floor((floor(智力*80/100)+floor(sqrt(武力)/2)+等级)*体力/100)
export function initialMp(
  effIntel: number,
  effForce: number,
  level: number,
  stamina: number
): number
// 解锁数 = min(floor(默认数*等级/21)+1, 默认数)；取 DEFAULT_SKILLS 前 N
export function unlockedCount(defaultCount: number, level: number): number
// 当前可用技能集 = 已解锁默认 ∪ 个人技能 ∪（君主则 LORD_SKILLS）
export function availableSkills(
  troopType: TroopType,
  level: number,
  personal: readonly number[],
  isLord: boolean
): Set<SkillId>

// 倍率链（§6.4.4）：每步 floor。base 取 baseTroops 或 baseFood。
export function effectValue(
  base: number,
  mulWeather: number,
  mulTargetTroop: number,
  mulTargetTerrain: number,
  mulCasterTerrain: number
): number
// 四关倍率取数助手（按 enum 反查序）
export function weatherMul(def: SkillDef, w: Weather): number
export function targetTerrainMul(def: SkillDef, t: Terrain): number
export function casterTerrainMul(def: SkillDef, t: Terrain): number
export function targetTroopMul(def: SkillDef, tt: TroopType): number
// 可用性四关（§6.4.2）：天气≠0 且 施法者地形≠0；target∈{enemy,ally} 时再加 目标地形≠0 且 目标兵种≠0
export function skillGatesPass(
  def: SkillDef,
  weather: Weather,
  casterTerrain: Terrain,
  target?: { terrain: Terrain; troop: TroopType }
): boolean
// 成功率（§6.4.3）：施法能力=施法者有效智力+等级+5；目标抗性（self→0）；R=randInt(0,抗性+19)≤floor(能力/2)
export function rollSkillSuccess(
  castAbility: number,
  targetResist: number,
  rng: Rng
): readonly [boolean, Rng]
```

### military/battle-movement.ts（修改）

```ts
// 既有 u.routed 判断改为 u.status==='dead'（unitAt/zocTiles 等）。
// reachableTiles 内：unit.status==='rooted' → 预算=1；unit.status==='qimen' → 跳过接敌停步压制。
// 新增：技能目标候选格（套 RANGE_MASK，界内即返回；self 技能返回 []）
export function skillTargetTiles(map: BattleMap, from: Position, skillId: SkillId): Position[]
```

### military/battle.ts（修改）

```ts
export interface BattleUnit {
  // …既有 officerId/side/pos/troops/experience/level/acted（去掉 routed）…
  readonly mp: number
  readonly maxMp: number
  readonly status: BattleStatus // 'dead'=击溃（替代 routed）
}
export interface BattleState {
  // …既有…
  readonly weather: Weather
}
export type BattleAction =
  | {
      type: 'act'
      officerId: OfficerId
      moveTo?: Position
      terminal:
        | { kind: 'attack'; target: Position }
        | { kind: 'rest' } // rest 顺带 +1 MP（封顶 maxMp）
        | { kind: 'cast'; skillId: SkillId; target?: Position }
    } // 无目标技能省略 target
  | { type: 'endDay' }
  | { type: 'retreat' }

// initBattle：增 weather='wind'；每单位 mp=maxMp=initialMp(...)、status= troops===0?'dead':'normal'。仍纯快照、不耗 rng。
// 既有结算里 routed:boolean 改写 status='dead'；experienceGain 等纯公式仍收 routed:boolean 入参（=本次是否击溃）。
// 每日开头共享过程（查30天→刷天气(rng)→逐非死亡单位 dailyStatusCheck(rng)+石阵损兵→重置 acted→胜负检查）。
export function startDay(state: GameState): GameState
// canBattle 扩展：act 要 canActWithStatus(unit.status)；cast 终结要 canCastWithStatus、技能∈availableSkills、
//   mp≥cost、skillGatesPass、且 enemy/ally 目标在 skillTargetTiles 内且阵营匹配；self 无目标。
// applyAct 扩展：cast → rollSkillSuccess（先扣 mp、无论成败）；成功按 def 结算：
//   伤害(enemy,baseTroops)= min(effectValue,目标兵力)；恢复(ally,baseTroops)= min(effectValue, 带兵量上限-当前)；
//   破粮(baseFood)= min(effectValue, 敌方战场粮草) 扣对手 provisions；status(目标未死亡 status!=='dead' 时置，rooted 即生效于移动)；
//   special: weather→refreshWeather；intel→no-op（UI 读 opponentProvisions）；siege→相邻(上/下/左/右)友军逐个普攻(复用 computeDamage+经验)。
// advanceDay(endDay)：扣双方当日粮草 → day+1 → startDay。
```

### world/officer.ts（修改）

```ts
export interface Officer {
  // …既有…
  readonly personalSkills: readonly number[] // 个人技能 id（fixture 播种、默认 []）；用 number 规避 world→military 依赖
}
```

### turn/end-month.ts（修改）

```ts
// advanceCampaigns 中玩家 campaign 分支：把 initBattle 结果装入 activeBattle 后立刻跑 startDay（走第 1 天开头）。
//   return startDay({ ...state, activeBattle: initBattle(state, c.officerIds, c.targetCityId, c.provisions) })
```

## 模块职责

- `military/battle-weather.ts`：天气枚举 + 倍率维序 + 刷新（耗 rng）。叶子、纯。
- `military/battle-status.ts`：全状态枚举（含 'dead'）+ 行动/施法许可谓词 + 石阵损兵 + 每日判定（耗 rng）。叶子、纯；死亡=唯一真相、替代 routed。
- `military/battle-skill.ts`：技能定义表 + 30 掩码 + 维序常量 + 默认/君主技能表 + MP/解锁/倍率链/四关/成功率纯公式。技能规则唯一收敛处；不读 state、入参传值。
- `military/battle-movement.ts`：加定身/奇门对可达的影响 + 技能目标候选格。
- `military/battle.ts`：编排——快照 mp/status/weather、`startDay`、`canBattle`/`applyAct` 的 cast 与状态门、`advanceDay` 串 startDay。仍不 import turn。
- `turn/end-month.ts`：唯一掌握月末/日界编排处，第 1 天 startDay 接线。
- `world/officer.ts` / `world/fixture.ts`：`personalSkills` 字段与播种。

## 要测的行为

- [ ] `battle-weather`：refreshWeather 均匀映射、确定性推进 rng。
- [ ] `battle-status`：canAct（混乱/石阵/死亡 false）、canCast（禁咒/死亡 false）、stoneDamage=floor(/8)、dailyStatusCheck 各状态组按 `randInt(0,59)<floor(智力/2)` 恢复/不变、死亡跳过不耗 rng。
- [ ] `battle-skill`：initialMp 公式（吃有效武力/智力）、unlockedCount（封顶默认数、按序取）、availableSkills（默认∪个人∪君主）、effectValue 五步逐 floor、四关 skillGatesPass（self 只看天气+施法者地形；enemy/ally 加目标地形+兵种；任一 0 即 false）、rollSkillSuccess（self 抗性=0；阈值 floor(能力/2)；失败也推进 rng）。
- [ ] `RANGE_MASK`/`skillTargetTiles`：按附录掩码取候选格、越界剔除、self→[]。
- [ ] movement：定身单位预算=1；奇门单位可穿越接敌停步区；其余沿用 12 不回归。
- [ ] `initBattle`：每单位 mp=maxMp=公式值、status=（troops===0?dead:normal）、weather=wind；其余沿用 12（含 12 的 routed→status==='dead' 重构无回归）。
- [ ] `startDay`：查 30 天优先；刷天气；逐单位状态判定 + 石阵先损兵（可致 status='dead'）后判定；重置 acted；状态阶段后跑胜负检查；第 1 天经 turn 调用使开局天气随机。
- [ ] `canBattle` cast：禁咒拒、未解锁/无该技能拒、mp 不足拒、四关任一 0 拒、目标超掩码/阵营不符拒、self 无目标放行；混乱/石阵单位 act 全拒；非法 no-op。
- [ ] `applyAct` cast 结算：扣 mp（成败都扣）；伤害 min 目标兵力且可击溃触发胜负；恢复 min(上限-当前)；破粮扣对手 provisions（不立即判负）；命中置状态（已死亡 status==='dead' 不置、定身即降移动力）；天变改天气；谍报不改状态；围攻相邻友军逐个普攻含经验、可致击溃。
- [ ] `advanceDay`：扣当日粮草 → day+1 → startDay；端到端含天气/状态两步、不破坏 12 既有移动/普攻/粮草/胜负。
- [ ] 回归：同 seed 整局可复现；无技能旧 battle/turn/game 测试经补字段后全绿。

## 新建文件

- `src/core/military/battle-weather.ts`：天气类型/维序/刷新。
- `src/core/military/battle-status.ts`：可控状态/谓词/石阵损兵/每日判定。
- `src/core/military/battle-skill.ts`：技能表/掩码/维序/默认·君主技能/MP·解锁·倍率链·四关·成功率公式。
- 对应 `*.test.ts`（同级）：`battle-weather`/`battle-status`/`battle-skill` + `battle`/`battle-movement` 增补。

## 修改文件

- `src/core/military/battle.ts`：`BattleUnit` 去 `routed`、加 `{mp,maxMp,status}`（'dead'=击溃）、`BattleState{weather}`、`act` 加 `cast` 终结、`initBattle` 补字段、既有 `routed` 写/读改 `status==='dead'`、新增 `startDay`、`canBattle`/`applyAct` cast 与状态门、`advanceDay` 串 startDay。
- `src/core/military/battle-movement.ts`：`u.routed`→`u.status==='dead'`、定身/奇门对可达的影响、`skillTargetTiles`。
- `src/core/world/officer.ts`：加 `personalSkills: readonly number[]`。
- `src/core/world/fixture.ts`：播种 `personalSkills`（默认 []，少量武将带 22/23/24/25 等）。
- `src/core/turn/end-month.ts`：玩家 campaign 第 1 天接 `startDay`。
- 既有 `*.test.ts` / 构造助手：`BattleUnit` 去 `routed`、补 `mp/maxMp/status`，补 `BattleState.weather`、`Officer.personalSkills`。

## 任务清单

- [x] `battle-weather.ts` + `battle-status.ts`（类型/谓词/损兵/刷新/每日判定，红绿）。
- [x] `battle-skill.ts` 数据与公式：SKILL_DEFS(27)+RANGE_MASK(附录A 录入)+维序+默认/君主表 + initialMp/unlockedCount/availableSkills/effectValue/四关/rollSkillSuccess（红绿）。
- [x] `Officer.personalSkills` + `BattleUnit` 去 `routed` 加 `{mp,maxMp,status}` + `BattleState.weather` + 既有 `routed` 用例改 `status==='dead'` + fixture/构造补字段，使既有测试编译通过。
- [x] `battle-movement`：`routed`→`status==='dead'`、定身预算=1、奇门穿越、`skillTargetTiles`（红绿）。
- [x] `battle.initBattle` 补 mp/status/weather + `startDay`（查30/刷天气/状态判定+石阵损兵/重置/胜负，红绿）。
- [x] `battle.canBattle`/`applyAct` 的 cast 与状态门（成功率/扣 mp/伤害·恢复·破粮·状态·天变·谍报·围攻，红绿）。
- [x] `battle.advanceDay` 串 startDay + `turn/end-month` 第 1 天接线；`game.test` 端到端（出征→挂起→施法/休息→续月末），全量回归。

## TDD：是

## 风险 / 待定

- **每日刷天气恒耗 rng**：无技能战斗的 `endDay` 也会推进 rng（天气是核心机制）。既有 battle 测试不断言 rng/weather，应不回归；同 seed 仍可复现。
- **个人技能 fixture 体量**：22/23/24/25 等非默认技能须经个人技能播种才可用，具体给谁留平衡期；默认 []。
- **掩码录入**：27 张掩码从根目录 `appendix-a-skill-ranges.md` 逐张转为偏移数组，build 阶段核对（self 技能忽略）。
- **围攻经验**：触发的相邻友军普攻按既有 `experienceGain` 给经验，可能升级；施法者本人无经验。
- **谍报核心无效果**：core 全可见，谍报仅判成功 + 扣 mp，揭示对手粮草属 UI；若日后引入战争迷雾再补。
- **多支出征/防守模式**：沿用 12 串行与「对手静止、仅玩家进攻可达」；AI 施法/主动出征仍留后续切片，结构已预留 side/mode。

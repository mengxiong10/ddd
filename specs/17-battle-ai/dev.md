# battle-ai 开发文档

## 方案概述

让对手方（AI，始终 `side==='opponent'`）在地图战中真正行动，替换 `battle.ts` 里 `advanceDay` 现存的「对手方行动（本切片 no-op）」。核心三处取舍：

- **把 `battle.ts` 拆成 3 文件，依赖单向**（用户定）：
  - `battle-core.ts`（核心机制，新）：类型 + 单位助手 + `computeDamage`/`basicAttack`/`applyCastEffect`/`applyActResolved`/`canBattle`/`canCast`/`checkImmediateVictory`。**`applyActResolved` 是从旧 `applyAct` 抽出的「已校验即应用」核心**（移动 + 终结动作结算 + 即时胜负），不含 player-only 门。
  - `battle-ai.ts`（对手决策，新）：选将 / 选落点 / 选动作，产出一个 `BattleAction`（`act`），**只 `import` `battle-core` 运行时 + 现有叶模块（movement/combat/skill/map/status）+ world/shared**，不 import 编排文件 → 无环。
  - `battle.ts`（编排，保名）：`initBattle`/`startDay`/`advanceDay`/`reduceBattle`/`concludeBattle`，import `battle-core` + `battle-ai`，并**再导出** `battle-core` 的类型与 `canBattle`，使 `game.ts`/`game-state.ts`/`turn` 等外部 `from './military/battle'` 零改动。
- **AI 在 `endDay` 内一次性跑完整个对手方回合**：`advanceDay` 先 `runOpponentTurn`（循环「选将→决策→应用」直到无可动 AI 单位或已分胜负），再扣双方当日粮草、`day+1`、`startDay`（沿用）。玩家每日先手、AI 后手。
- **复用真打的结算，决策与应用分离**：`battle-ai` 只**决策**（选格/选动作，消费 rng 于技能筛与简单选技），不结算；`battle.ts` 编排循环里调 `battle-core.applyActResolved` 真正落子（普攻/施法结算、技能成功率 rng、即时胜负）。AI 选定的动作在决策期已用 `reachableTiles`/`attackableTiles`/`skillTargetTiles` + 四关保证合法，故 `applyActResolved` 跳过 `canBattle`（`canBattle` 仍仅校验玩家方、供 `game.canApply` 与玩家 `act` 路径）。

**确定性**：`battle` 自 `13` 起本就消费 `GameState.rng`；AI 选将/选落点纯比较（不耗 rng），技能筛（`RandInt(0,149)`、非玄兵带兵量筛）与「简单选技」随机抽取耗 rng，单位/技能遍历定序，同 seed 全程可复现。

**无环校验**：`battle-ai → battle-core`（运行时）、`battle-movement → battle-core`（仅 `import type`）、`battle → {battle-core, battle-ai}`（运行时）；`battle-core` 不 import `battle-ai`/`battle`。

## 接口设计

只写签名，不写实现体。

### `military/battle-core.ts`（新建·从 battle.ts 抽出的核心机制）

```ts
// —— 类型（原样从 battle.ts 迁来）——
export type BattleSide = 'player' | 'opponent'
export type BattleMode = 'attack' | 'defend'
export type BattleOutcome = 'playerWin' | 'playerLose'
export interface BattleUnit {
  /* …不变… */
}
export interface BattleState {
  /* …不变… */
}
export type BattleAction =
  | {
      readonly type: 'act'
      readonly officerId: OfficerId
      readonly moveTo?: Position
      readonly terminal:
        | { readonly kind: 'attack'; readonly target: Position }
        | { readonly kind: 'rest' }
        | { readonly kind: 'cast'; readonly skillId: SkillId; readonly target?: Position }
    }
  | { readonly type: 'endDay' }
  | { readonly type: 'retreat' }

// 单位助手（导出供 battle-ai 复用，原 battle.ts 私有）
export const aliveUnits: (battle: BattleState) => BattleUnit[]
export const unitAt: (battle: BattleState, p: Position) => BattleUnit | undefined
export const sideTroops: (battle: BattleState, side: BattleSide) => number
export const sideAlive: (battle: BattleState, side: BattleSide) => boolean

// 一次普攻预估/实算共用：从 atkPos（默认 attacker.pos）对 defender 的实际扣兵。
// 新增可选 atkPos —— AI 预估「若该单位站在候选落点」时的伤害。
export function computeDamage(
  state: GameState,
  map: BattleMap,
  attacker: BattleUnit,
  defender: BattleUnit,
  atkPos?: Position
): number

// 校验（供 game.canApply 与玩家 act 路径）：仍要求 unit.side==='player'。
export function canBattle(state: GameState, action: BattleAction): CommandCheck

// 即时胜负（城池格/主将击溃/全灭）。
export function checkImmediateVictory(battle: BattleState, map: BattleMap): BattleOutcome | null

// 已校验即应用（从旧 applyAct 抽出、去掉 canBattle 门）：移动到 moveTo、结算 attack/rest/cast
// （含技能成功率 rng + 施法效果），置 acted，跑 checkImmediateVictory 写 outcome。玩家路与 AI 路共用。
export function applyActResolved(
  state: GameState,
  battle: BattleState,
  action: Extract<BattleAction, { type: 'act' }>
): GameState
```

### `military/battle-ai.ts`（新建·对手方决策叶）

```ts
// 产出对手方下一个行动（选将→选落点→选终结动作），并返回推进了 rng 的 state；无可动 AI 单位返回 null。
// 调用方（battle.advanceDay 的 runOpponentTurn 循环）拿到后用 battle-core.applyActResolved 落子，再回头取下一个。
export function nextOpponentAction(
  state: GameState
): { readonly state: GameState; readonly action: Extract<BattleAction, { type: 'act' }> } | null
```

内部 helper（不导出）：

```ts
// 目标点（§7.3，纯由模式定）：attack→玩家主将(attackerCommanderId)格；defend→城池格中心(map.cityTiles 的代表点)。
function targetPoint(state: GameState, battle: BattleState, map: BattleMap): Position
// 玩家主将 id（AI 的「敌方主将」）：attack→attackerCommanderId；defend→defenderCommanderId。
function playerCommanderId(battle: BattleState): OfficerId
// 选将（§7.2）：对手方、非 dead/confused/stone（canActWithStatus）、未 acted；取离目标点曼哈顿最小（平局 officerId 升序）。
function selectUnitId(state: GameState, battle: BattleState, map: BattleMap): OfficerId | null
// 选落点（§7.4，确定性）：①已站城池格→原地 ②defend 模式且某可达点∈cityTiles→该点(进城即胜) ③否则按
//   (预估伤害降序; 若全 0 则离目标点更近; 防御地形(山/林/村/城/寨)优先; 离起点更远; 坐标序) 取最优。
function chooseTile(
  state: GameState,
  battle: BattleState,
  map: BattleMap,
  officerId: OfficerId
): Position
// 落点伤害预估（§7.5，只看普攻）：扫该兵种 attackableTiles 内活着的玩家方单位；玩家主将在内→+∞；
//   否则取各目标 computeDamage(…, fromPos) 最大值；无目标→0。
function estimateBestDamage(state, battle, map, officerId, fromPos): number
// 选终结动作（§7.6）：玄兵=技能优先；其余=攻击优先。回退链：技能不成立→普攻→休息（或攻击优先的对称链）。
function chooseTerminal(state, battle, map, officerId, pos, rng): readonly [Terminal, Rng]
// 选普攻目标：范围内玩家主将优先，否则 computeDamage 最大（平局 officerId 升序）。
function chooseAttackTarget(state, battle, map, officerId, pos): Position | null
// 技能筛 + 选技（§7.7，消费 rng）：禁咒→null(不耗rng)；RandInt(0,149)>有效智力→null；
//   非玄兵 RandInt(0, floor(带兵量×1.5))<当前兵力→null（玄兵免此筛）；再按模式选技。
//   玄兵=最佳(序号从高到低取第一个可施放者，不耗 rng)；非玄兵=简单(随机抽 1 个可用技能，能施放则放、否则 null)。
function trySkill(state, battle, map, officerId, pos, rng): readonly [Terminal | null, Rng]
// 某技能在 pos 是否可施放并定目标：跳过 self 技能(天变/谍报)；MP≥mp、四关(weather/施法者地形/目标地形/目标兵种≠0)、
//   范围内有合法目标(敌/友按 target；治疗(ally 且 baseTroops>0)只取损失≥1/4兵力者)。返回目标格或 null。
//   选目标：敌方→玩家主将优先否则 officerId 最小；治疗→最损血友军否则 officerId 最小。
function findSkillTarget(state, battle, map, officerId, pos, skillId): Position | null
```

### `military/battle.ts`（修改·瘦身为编排 + 再导出）

```ts
// 再导出核心类型与 canBattle，外部 `from './military/battle'` 零改动。
export type {
  BattleSide,
  BattleMode,
  BattleOutcome,
  BattleUnit,
  BattleState,
  BattleAction,
} from './battle-core'
export { canBattle } from './battle-core'

export function initBattle(/* 不变 */): BattleState // 留编排（含建 BattleUnit）
export function startDay(state: GameState): GameState // 不变
export function reduceBattle(state: GameState, action: BattleAction): GameState
//   act → canBattle 通过则 applyActResolved，否则 no-op；endDay → advanceDay；retreat → setOutcome(playerLose)
export function concludeBattle(state: GameState): GameState // 不变

// 私有 advanceDay：runOpponentTurn(对手方逐单位行动，已分胜负即停) → 若 outcome 则返回 → 否则扣双方当日粮草 → day+1 → startDay。
// 私有 runOpponentTurn：while 取 nextOpponentAction(state)，用 applyActResolved 落子，outcome 出现即停。
```

### `military/battle-movement.ts`（修改·仅改类型来源）

```ts
import type { BattleState } from './battle-core' // 原来自 './battle'
```

## 模块职责

- `military/battle-core.ts`：战斗核心机制（类型 + 单位助手 + 伤害/普攻/施法结算 + `applyActResolved` + `canBattle`/`canCast` + 即时胜负）。被 `battle`（编排）与 `battle-ai` 共用；不 import 编排/AI。
- `military/battle-ai.ts`：对手方**决策**——选将/选落点/选动作，产出 `act`。读 state + `battle-core`（类型/助手/computeDamage/checkImmediateVictory）+ movement/skill/map/status + world/shared；不结算、不 import 编排。
- `military/battle.ts`：编排——init/startDay/reduce/conclude + `advanceDay` 的对手方回合循环；再导出核心符号。外部唯一入口。
- 现有 `battle-movement`/`battle-combat`/`battle-skill`/`battle-status`/`battle-weather`/`battle-map`：不变（仅 movement 改 `import type` 来源）。

## 要测的行为

- [ ] **选将**：只取对手方、跳过 dead/confused/stone/已 acted；离目标点曼哈顿最小（平局 officerId 升序）；无可动→null。
- [ ] **目标点**：attack 模式=玩家主将格；defend 模式=城池格中心。
- [ ] **选落点阶梯**：已站城池格→原地；defend 模式可达城池格→进城（终将致 AI 胜）；预估普攻伤害更高优先；全打不到则离目标点更近；同档选防御地形；否则走更远；坐标序兜底（确定性）。
- [ ] **预估伤害**：玩家主将在普攻范围→视作 +∞（必选打主将的落点/目标）；否则 computeDamage 最大；无目标→0；只看普攻、不算技能。
- [ ] **攻击优先（非玄兵）**：可普攻→先试技能、技能不成立则普攻；不可普攻→试技能、否则休息。
- [ ] **技能优先（玄兵）**：先试技能、否则普攻、再否则休息。
- [ ] **技能筛**：禁咒直接不放（不耗 rng）；`RandInt(0,149) > 有效智力`→跳过；非玄兵 `RandInt(0, floor(带兵量×1.5)) < 当前兵力`→跳过（玄兵免此筛、走到选技）。
- [ ] **选技**：简单（非玄兵）= 随机抽 1 个可用技能、可施放则放否则技能不成立；最佳（玄兵）= 序号从高到低取第一个可施放者；均跳过 self 技能（天变/谍报）。
- [ ] **可施放判定/选目标**：MP≥、四关、范围内合法目标；敌方目标优先玩家主将否则 officerId 最小；治疗（ally 且 baseTroops>0）只给损失≥1/4兵力者、取最损血否则 officerId 最小。
- [ ] **`advanceDay` 对手回合**：玩家 `endDay` 后 AI 逐单位行动（攻击/施法/休息），每步即时胜负检查；AI 击溃玩家主将/全灭/(defend)进城→置 outcome 提前停（交 `resumeMonth` 收尾）；未分胜负则扣双方当日粮草→day+1→startDay。
- [ ] **确定性**：同 seed 下整局战斗（含 AI 行动）逐步可复现；AI 从不 `retreat`。
- [ ] **回归**：拆分后既有 `battle.test`/`battle-movement.test`/`end-month`/`game` 全绿（外部 `from './battle'` 行为不变）；玩家进攻 AI 城时 AI 守军会还手（旧用例若假设对手静止需更新）。

## 新建文件

- `src/core/military/battle-core.ts`：战斗核心机制（从 `battle.ts` 抽出）。
- `src/core/military/battle-ai.ts`：对手方决策（选将/选落点/选动作）。
- `src/core/military/battle-ai.test.ts`：AI 决策行为（选将/落点/伤害预估/攻击或技能优先/技能筛/选技/选目标）。

## 修改文件

- `src/core/military/battle.ts`：瘦身为编排（init/startDay/reduce/conclude + `advanceDay` 对手回合循环），import `battle-core`+`battle-ai`，再导出核心类型与 `canBattle`。
- `src/core/military/battle-movement.ts`（+ `.test.ts`）：`import type { BattleState }` 改自 `./battle-core`。
- `src/core/military/battle.test.ts`：补「玩家进攻时 AI 守军行动」集成用例；既有用例随再导出保持不变（必要时更新「对手静止」假设）。

## 任务清单

- [x] 抽 `battle-core.ts`：迁类型 + 助手 + computeDamage(加 `atkPos`) + basicAttack/applyCastEffect + canBattle/canCast + checkImmediateVictory + `applyActResolved`（去 canBattle 门）；`battle.ts` 再导出并改用之；movement 改类型来源。全量回归绿（纯重构、行为不变）。
- [x] `battle-ai.ts` 选将 + 目标点 + 选落点（含进城/站城/伤害排序，确定性，红绿）。
- [x] `battle-ai.ts` 预估伤害（主将∞）+ 选普攻目标（红绿）。
- [x] `battle-ai.ts` 技能筛 + 简单/最佳选技 + 可施放/选目标（含治疗筛、跳 self，红绿、耗 rng 可复现）。
- [x] `battle-ai.ts` `nextOpponentAction` 串起攻击优先/技能优先回退链（红绿）。
- [x] `battle.ts` `advanceDay` 接 `runOpponentTurn`（对手逐单位行动→即时胜负→扣粮→day+1→startDay）；`battle.test` 集成（玩家进攻→AI 守军还手→可复现）。
- [x] 全量回归 + typecheck；`AGENTS.md` 红线 + 状态置（ready/done）、`CONTEXT.md` 术语已在 PRD 阶段写入。

## TDD：是

游戏核心 `src/core/`，按 CONSTITUTION 默认 TDD，以上行为清单驱动红绿。

## 决策升级（收尾写入根文件）

- **AGENTS 架构红线（新增一条）**：战斗 AI（`17-battle-ai`）——`military/battle` 拆为 **编排 `battle.ts` + 核心 `battle-core.ts` + 对手决策 `battle-ai.ts`** 三文件，依赖单向（`battle → {battle-core, battle-ai}`、`battle-ai → battle-core`、`battle-core` 不反向），`battle.ts` 再导出核心符号保外部零改动。`endDay` 对手方不再 no-op：`advanceDay` 先跑 `runOpponentTurn`（循环 `battle-ai.nextOpponentAction` 决策 + `battle-core.applyActResolved` 应用，每步即时胜负）再扣粮进下一天。决策（battle-ai）与结算（battle-core）分离，`applyActResolved` 去 player 门、`canBattle` 仍仅玩家方。AI 选位只算普攻不评估技能收益、从不撤退；全程消费 `GameState.rng` 可复现。
- **CONTEXT 术语**：已在 PRD 阶段写入（战斗 AI / 战斗目标点 / AI 选将 / AI 选落点 / AI 预估伤害 / AI 攻击方式 / AI 放技能筛）。

## 风险 / 待定

- **`最佳模式`实现偏差**：原文「序号越高被抽中概率越大」实现为**确定性「序号从高到低取第一个可施放」**（不耗 rng、最易测）；偏好高序号（≈高威力）的意图保留，随机性舍弃。
- **self 技能（天变/谍报）AI 不施放**：天变改天气本可有益，但 AI「不评估技能收益」、谍报对 core 无效，故一律跳过；如需 AI 天变留后续。
- **城池格「中心」**：`map.cityTiles` 可能多格，取代表点（如第一格/几何中心）作目标点；具体取法实现期定，须确定性。
- **defend 模式实际触发依赖 `16-ai-campaign`**：本切片同时实现两模式行为；`attack` 模式（AI 守城）今日即可达（玩家进攻），`defend`（AI 推城）须 `16` 实装后才发生。
- **AI 防守仅「扑主将 + 站城上不动」**：除此无额外守城池格倾向（PRD 待定），观察后再议。
- **拆分回归面**：`battle.ts` 拆 3 文件是纯重构步，必须在加 AI 前先让全量测试绿，隔离「重构」与「新行为」两类改动。
- **施法者自身排除（实现期定）**：决策时单位的移动尚未落到 `battle.units`，其**旧格**仍在 state 里。`findSkillTarget` 须显式跳过 `tu.officerId === caster.officerId`，否则「站旧格的自己」会被当成友方治疗目标。普攻/预估伤害扫描按 `tu.side===unit.side` 已自然排除自身（同阵营），无需额外处理。

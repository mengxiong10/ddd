# ai-economy 开发文档

## 方案概述

把 `core/ai/ai.ts` 的空步 `aiTakeTurn` 实现为完整的 AI 月度经营。**月末编排不变**：`endMonth` 已把 `aiTakeTurn` 跑在最前，AI 产物（立即效果 + 入队命令）与玩家命令一起由 `runNonCampaignPending`/`advanceCampaigns` 在同一月末结算——本切片**不动 `turn` 层**。

关键设计取舍：

- **AI 是"作弊简化"路径**：固定成长（+200 等）、不扣金/体力、不吃智力公式、不走 `canX`。AI 的"下令阶段" = 立即施加固定效果（开垦/招商/出巡/治理/即时招降·处斩）或 `busyEnqueue`（置 `Officer.busy` + push `PendingCommand`）；**月末结算复用现有 `executeSearch/executeMove/executeEntice/...`**（单一月末结算源）。
- **不复用玩家下令体**（`search()/move()/entice()` 会扣成本、跑 `canX`）；AI 统一经 `busyEnqueue`，心智模型最简：AI 下令 = 只占人 + 入队。
- **占人统一用 `Officer.busy`**：下令瞬间生效的命令只置 busy、不新增 `pendingCommands` 分支；仅搜寻/移动/外交（离间/招揽/策反/劝降）入队、复用现有判别式分支。
- **本切片不产生任何 AI 出征**：军备模块出征分支（随机值 7）与相关条件留 TODO 注释；`advanceCampaigns`「AI 不出征故无非玩家 campaign」假设仍成立、不变。
- **确定性**：全程消费 `GameState.rng`，城按 id 升序、武将按 id 升序遍历，同 seed 可复现（沿用 disaster「按 id 升序」约定）。
- **布局**：模仿 `military/battle` 的「编排器 + 叶模块」——`ai.ts` 编排 + 两个短 sweep，`ai-shared.ts` 放跨叶共享助手（无循环依赖），`ai-internal/diplomacy/military.ts` 三叶各自深实现。

## 接口设计

只写签名，不写实现体。依赖方向：`ai/* → economy/* + world/* + shared/*`（单向，不被反向依赖）。

### `shared/rng.ts`（新增通用组合子）

```ts
// 等概率取数组一元素，消耗 rng。前置：items 非空（调用方保证）。
export function pickRandom<T>(rng: Rng, items: readonly T[]): readonly [item: T, next: Rng]
```

### `world/officer.ts`（新增）

```ts
// 直接升 1 级（AI 自动升级 / 军备 month%3 用）；不走经验、无上限。
export function levelUp(o: Officer): Officer
```

### `shared/config.ts`（新增旋钮）

```ts
interface GameConfig {
  // …既有字段…
  /** AI 自动升级速度：每月每名 AI 武将 RandInt(0,99) < 此值则 +1 级。0=关。AI 难度旋钮。 */
  readonly aiLevelUpRate: number
}
// DEFAULT_CONFIG.aiLevelUpRate = 0
```

### `economy/diplomacy.ts`（导出既有谓词，供 AI 选目标池复用，零行为变更）

```ts
export function isEnemyServingNonLord(
  state,
  execLord: OfficerId | null,
  targetId: OfficerId
): boolean
export function isInstigateTarget(state, execLord: OfficerId | null, targetId: OfficerId): boolean
```

### `ai/ai-shared.ts`（新建，跨叶共享）

```ts
// 本城在任武将（onlyAvailable），按 id 升序——AI 模块的统一遍历序（决定 move 的「武将序号 i」）。
export function aiServingOfficers(state: GameState, cityId: CityId): Officer[]
// AI 入队：置执行人 busy + 追加 PendingCommand；不扣任何成本、不动 RNG。
export function busyEnqueue(state: GameState, officerId: OfficerId, cmd: PendingCommand): GameState
```

### `ai/ai.ts`（编排器，替换空步）

```ts
// 阈值表按君主性格 0..4（和平/大义/奸诈/狂人/冒进）索引。
const AI_INTERNAL_THRESHOLD: readonly number[] // [50,40,30,20,10]
const AI_DIPLO_THRESHOLD: readonly number[] // [80,70,70,40,20]

// 月度：① 兜底所有 AI 城 ② 自动升级 ③ 逐 AI 城选路径并跑对应模块。
export function aiTakeTurn(state: GameState, config: GameConfig): GameState

// 5.3 兜底：每座非玩家城 status→normal、防灾+1 封顶、粮<100→500。不耗 RNG。
export function runAiBottomLine(state: GameState): GameState

// 5.4 自动升级：rate=0 整体跳过且不动 RNG；rate>0 时按 id 升序对每名
// 非玩家(lordId≠playerLordId)、非在野(lordId≠null)、非俘虏武将 RandInt(0,99)<rate → levelUp。
export function runAiLevelUp(state: GameState, config: GameConfig): GameState
```

### `ai/ai-internal.ts`（5.5.1）

```ts
// 内政：对 aiServingOfficers 逐人（带序号 i）RandInt(0,10) 分派。
export function runAiInternal(state: GameState, cityId: CityId): GameState
```

值表（固定成长常量内联本文件：DEVELOP +200 / PATROL 民忠+4·人口+100 / GOVERN 防灾+4）：

| 值         | 行为                                                      |
| ---------- | --------------------------------------------------------- |
| 0/1        | 开垦/招商 +200 封顶上限（`raiseAttribute`）+ `setBusy`    |
| 2          | `busyEnqueue {type:'search'}`                             |
| 3          | `gainLoyalty(+4)` + `addPopulation(+100)` + `setBusy`     |
| 4          | `setStatus('normal')` + `raisePrevention(+4)` + `setBusy` |
| 5/6/7/8/10 | 跳过                                                      |
| 9          | 满足移动条件 → `busyEnqueue {type:'move', targetCityId}`  |

移动条件（全满足才入队）：`i ≥ 3`；`citiesOfLord(lordId).length ≥ 2`；目标 = 选城算法结果。选城：初始候选 = 本势力城（id 升序）首座；按序扫描本势力城，遇「有相邻敌城」者更新为候选并 `RandInt(0,1)===0`（50%）即停步返回；全程无敌邻城则用初始候选。`hasAdjacentEnemy(state,cityId,lordId)` = `adjacency` 某邻城 `lordId≠该势力`（玩家城算敌）。目标可能 = 本城，`executeMove` 容忍（落同城、无害）。

### `ai/ai-diplomacy.ts`（5.5.3）

```ts
// 外交：对 aiServingOfficers 逐人 RandInt(0,7) 分派。无强制规则（已去掉 force-0）。
export function runAiDiplomacy(state: GameState, cityId: CityId): GameState
```

| 值  | 行为                                                                                            |
| --- | ----------------------------------------------------------------------------------------------- |
| 0   | 有俘虏 → `pickRandom` 选俘虏，**即时**改其 `lordId = city.lordId`（派生不再是俘虏）；无俘虏跳过 |
| 1   | 有俘虏 → `pickRandom` 选俘虏，复用 `behead`；无俘虏跳过                                         |
| 2/7 | 跳过                                                                                            |
| 3/4 | 池 = `isEnemyServingNonLord` 全体；非空 → `pickRandom` → `busyEnqueue {alienate/entice}`        |
| 5   | 池 = `isInstigateTarget` 全体；非空 → `busyEnqueue {instigate}`                                 |
| 6   | 池 = 敌方君主（`o.lordId===o.id ∧ o.id≠aiLord ∧ 非俘虏`）；非空 → `busyEnqueue {induce}`        |

### `ai/ai-military.ts`（5.5.4）

```ts
// 军备：先 pickRandom 选强化对象；month%3===0 则 levelUp 之；再逐人 RandInt(0,8)。
export function runAiMilitary(state: GameState, cityId: CityId): GameState
```

| 值        | 行为                                                                                                                    |
| --------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1/2/3/4/5 | 强化对象 `troops = troopCapacity(effectiveOfficer(state, 强化对象))`（`setTroops`）；不扣金、不动后备兵、不占人、不入队 |
| 0/6/8     | 跳过                                                                                                                    |
| 7         | 出征——**本切片 TODO**（最弱相邻敌城/兵力门槛/带兵 ≤10/粮草填满等留注释，不产生命令）                                    |

## 模块职责

- `ai/ai.ts`：月度编排（兜底 → 升级 → 逐城选路径分派）+ 性格阈值表；唯一 import 三叶模块（单向）。
- `ai/ai-shared.ts`：跨叶共享助手（在任武将排序、busyEnqueue）；只依赖 world/game-state，不 import 叶模块（破环）。
- `ai/ai-internal.ts` / `ai-diplomacy.ts` / `ai-military.ts`：各自一条策略路径的逐武将决策（深模块、小接口 `(state, cityId) => state`）。
- `economy/diplomacy.ts`：导出两个目标谓词供 AI 选池，行为不变。
- `world/officer.ts`：`levelUp` 纯函数（AI 升级与军备共用）。
- `shared/rng.ts`：`pickRandom` 通用 RNG 组合子。

## 要测的行为

- [ ] 兜底：AI 城 status→normal、防灾 +1 封顶 100、粮<100→500；玩家城完全不变；不耗 RNG。
- [ ] 自动升级：`rate=0` 时无任何升级且 rng 不变；`rate>0` 时仅 AI 方非俘虏武将可 +1 级、玩家武将永不升、在野/俘虏不升；同 seed 结果固定。
- [ ] 选路径：按君主性格阈值正确三分（边界 `R<内政→内政`、`内政≤R<外交→外交`、`R≥外交→军备`），用 seeded rng 命中各支。
- [ ] 内政：值 0/1 农商 +200 且封顶；2 入队 search；3 民忠+4·人口+100；4 状态正常·防灾+4；均置 busy 且不扣城金；9 满足条件入队 move（i<3 或城<2 时不入队）；移动选城偏好相邻敌城且 50% 停步。
- [ ] 外交：有俘虏时 0 即时招降（俘虏 lordId 翻己方、`isCaptive` 转否）/1 即时处斩（道具退城、删人）；无俘虏 0/1 跳过；3/4/5/6 池非空才入队、池空跳过；入队项月末经现有 executeX 结算。
- [ ] 军备：强化对象兵力补满至有效带兵量上限；`month%3===0` 时强化对象先 +1 级且补兵用新上限；不扣金/不动后备兵/不占人；不产生任何 campaign 入队。
- [ ] 集成：`endMonth` 一次推进中 AI 城自主行动、AI 入队命令在月末与玩家命令一并结算；玩家城/武将不被 AI 触碰；整月同 seed 可复现。

## 新建文件

- `src/core/ai/ai-shared.ts`：AI 跨叶共享助手（在任武将排序、busyEnqueue）。
- `src/core/ai/ai-internal.ts`：内政模块。
- `src/core/ai/ai-diplomacy.ts`：外交模块。
- `src/core/ai/ai-military.ts`：军备模块。
- 各 `*.test.ts`：上述模块关键行为单测。

## 修改文件

- `src/core/ai/ai.ts`：实现 `aiTakeTurn` + `runAiBottomLine` + `runAiLevelUp` + 阈值表，分派三叶。
- `src/core/shared/config.ts`：`GameConfig` 加 `aiLevelUpRate`，`DEFAULT_CONFIG` 默认 0。
- `src/core/shared/rng.ts`：加 `pickRandom`。
- `src/core/world/officer.ts`：加 `levelUp`。
- `src/core/economy/diplomacy.ts`：导出 `isEnemyServingNonLord`、`isInstigateTarget`（行为不变）。

## 任务清单

- [x] 脚手架：`config.aiLevelUpRate`(0) + `officer.levelUp` + `rng.pickRandom` + 导出 diplomacy 两谓词（各带最小单测）。
- [x] `runAiBottomLine` + 测（AI 城归一、玩家城不变）。
- [x] `runAiLevelUp` + 测（rate=0/不变、rate>0 仅 AI 非俘虏、确定性）。
- [x] `ai-shared`（aiServingOfficers/busyEnqueue/byId）+ 编排器选路径骨架（三叶先空实现）+ 选路径阈值测（`pickStrategy`）。
- [x] `ai-internal` 全分支 + 移动选城（`pickMoveTarget`）+ 测。
- [x] `ai-diplomacy` 全分支（即时招降/处斩 + 四入队）+ 测。
- [x] `ai-military` 补兵 + month%3 升级（出征 TODO）+ 测。
- [x] 端到端：经 `endMonth` 跑通一月 AI 经营 + 确定性/玩家不受扰集成测；`AGENTS.md` 状态置 done。

## TDD：是

游戏核心 `src/core/`，按 CONSTITUTION 默认 TDD，红绿循环驱动上述行为清单。

## 风险 / 待定

- **AI 选目标池为全武将线性扫描**：城/武将规模小（MVP 6–9 城），`O(officers)` 可接受，不预建索引（YAGNI）。
- **移动目标可能 = 本城**：忠实源逻辑，`executeMove` 落同城无害；不额外加 target≠source 守卫，保持 AI 下令极简。
- **`aiLevelUpRate` 进 config 属对 CONSTITUTION 配置原则的扩展**：见决策升级（新增「AI 难度旋钮」第三类）。
- **多 AI 势力**：本切片对每座非玩家城按其自身君主性格独立决策，天然支持多 AI 君主；势力间协同不做。

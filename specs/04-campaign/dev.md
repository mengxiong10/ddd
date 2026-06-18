# campaign（出征）开发文档

## 方案概述

出征是第二条"效果延到月末"的指令，复用既有"占人 = `Officer.busy` + `pendingCommands` 月末分派"的范式，但有三处首次引入：

- **城邻接**：在 `GameState` 增 `adjacency`（值对象，fixture 播种），`canCampaign` 据其校验"相邻=可达"。放进 state 而非全局常量/参数，使 `apply/canApply` 签名不变、可注入不同拓扑测试、可随存档序列化。
- **武将跨城移动 + 城易主**：`executeCampaign` 月末改攻方武将 `cityId` 与目标城 `lordId`。
- **俘虏为派生状态**：`isCaptive(state, officerId) = officer.lordId !== 所在城.lordId`，不新增字段；`officersInCity(onlyAvailable)` 顺便排除俘虏，守方兵力与重选候选池均借此排除。

**下令与战斗结算分属两个上下文**：出征的下令阶段（`canCampaign`/`campaign`：校验、扣本城粮、占人、入队）与开垦/征兵/掠夺等指令形态一致，归 `economy/campaign.ts`；战中/战后结算（战斗、占领、俘虏处理）归 `military/campaign.ts` 的 `executeCampaign`。两半经既有两个分派点接线（`game.apply → economy.campaign`、`turn/pending → military.executeCampaign`），互不 import。

战斗本切片从简（兵力总和比大小、攻 > 守才胜、确定性、不耗 RNG、无损耗），直接内联在 `military/campaign.ts`，暂不建 `battle.ts`（YAGNI，待战棋落地再抽）。被俘君主的重选/灭亡逻辑是"改多城多将归属"的世界操作，独立到 `world/succession.ts`，由 `executeCampaign` 调用（military 编排战后处理、world 提供归属重写）。

## 接口设计

### world/adjacency.ts（新建·值对象）

```ts
export type Adjacency = Readonly<Record<CityId, readonly CityId[]>>
// 由无向边对构造对称邻接表
export function buildAdjacency(edges: readonly (readonly [CityId, CityId])[]): Adjacency
// 对称查询：a、b 是否相邻
export function areAdjacent(adj: Adjacency, a: CityId, b: CityId): boolean
```

### world/queries.ts（修改）

```ts
// 派生俘虏判定：武将自身归属 ≠ 所在城归属
export function isCaptive(state: GameState, officerId: OfficerId): boolean
// onlyAvailable 现在含义 = 未占用(!busy) 且 非俘虏(!isCaptive)
export function officersInCity(state, cityId, opts?: { onlyAvailable?: boolean }): Officer[]
```

### economy/campaign.ts（新建·下令阶段）

```ts
// 单次出征武将上限（量纲上限，规则身份，内联常量）
const MAX_CAMPAIGN_OFFICERS = 10

// 校验出征前置（不改状态）；本城 = 选中武将共同所在城（officerIds[0].cityId）
export function canCampaign(
  state: GameState,
  officerIds: readonly OfficerId[],
  targetCityId: CityId,
  provisions: number
): CommandCheck

// 下令阶段（立即）：扣本城城粮 provisions、选中武将全部 busy、入队 campaign；非法 no-op
export function campaign(
  state: GameState,
  officerIds: readonly OfficerId[],
  targetCityId: CityId,
  provisions: number
): GameState
```

### military/campaign.ts（新建·战斗结算）

```ts
// 月末阶段：结算战斗（攻 > 守 才胜），移动攻方武将 cityId→目标城，
// 胜则目标城 lordId→攻方且城粮 += provisions，末了对攻/守两方君主各跑一次 resolveSuccession
export function executeCampaign(
  state: GameState,
  officerIds: readonly OfficerId[],
  targetCityId: CityId,
  provisions: number
): GameState
// 内部纯助手（不导出，经 executeCampaign 端到端测）：
//   attackerStrength = Σ 出征武将.troops
//   defenderStrength = Σ(目标城内 lordId===城.lordId 的武将.troops) + 城.reserveTroops
```

### world/succession.ts（新建）

```ts
// 若 lordId 这位君主当前为俘虏（君主所在城归属 ≠ 自身）：
//   - 该势力仍有城 → 从其「剩余未被俘武将」取智力最高者(平局取 id 字典序最小，保确定性)为新君主，
//     把该势力所有城与未被俘武将的 lordId 改归新君主；被俘君主与其余俘虏保持原 lordId。
//   - 该势力已无城 → 灭亡，原样返回（无新君主，剩余武将均为俘虏）。
// 君主未被俘则原样返回。攻/守两方 lordId 都调用一次（未被俘即 no-op）。
export function resolveSuccession(state: GameState, lordId: OfficerId): GameState
```

### game-state.ts（修改）

```ts
export type PendingCommand =
  | { readonly type: 'plunder'; readonly officerId: OfficerId }
  | {
      readonly type: 'campaign'
      readonly officerIds: readonly OfficerId[]
      readonly targetCityId: CityId
      readonly provisions: number
    }

export interface GameState {
  // …既有字段…
  readonly adjacency: Adjacency // 新增：城邻接拓扑（静态，fixture 播种）
}
```

### game.ts（修改）

```ts
export type Action =
  | /* …既有… */
  | { type: 'campaign'; officerIds: readonly OfficerId[]; targetCityId: CityId; provisions: number }
// canApply/apply 各加一分支，委派 canCampaign / campaign
```

## 模块职责

- `world/adjacency.ts`：城邻接值对象与对称查询；不依赖 state 以外的领域逻辑。
- `world/queries.ts`：世界读模型；新增 `isCaptive` 派生判定，并让 `officersInCity(onlyAvailable)` 排除俘虏。
- `economy/campaign.ts`：出征**下令阶段**（`canCampaign`/`campaign`）——与其它经营指令形态一致：校验、扣本城粮、占人、入队。依赖 world（city/officer/queries/adjacency）；不依赖 military。
- `military/campaign.ts`：出征**战斗结算**（`executeCampaign`）+ 内联战斗（兵力总和比较）。依赖 world（city/officer/queries）与 world/succession；不反依赖 turn/game/economy。
- `world/succession.ts`：被俘君主的重选/灭亡（跨城跨将 lordId 重写）；纯函数，仅读 queries.isCaptive + citiesOfLord，由 `executeCampaign` 调用。
- `turn/pending.ts`：月末分派新增 `campaign` 分支；**两趟执行**——先所有非 campaign（掠夺）按入队序，再所有 campaign 按入队序（兑现"出征排在普通待执行指令之后"）。
- `turn/end-month.ts`：无需为出征开特例——既有"回城"步仅 `busy:=false`+体力恢复，cityId 由 executeCampaign 决定，自动成立。

## 要测的行为

- [x] `canCampaign` 逐项前置：武将数 1~10、全在同一本城且在任(非 busy/非俘虏)、本城城粮 ≥1、provisions∈[1,城粮]整数、目标城存在且非本城非己方、目标与本城相邻——任一不满足返回 `{ok:false}` 且 reason 合理。
- [x] `campaign` 下令：本城城粮 -= provisions、选中武将全部 busy、入队 `campaign`；目标城/武将 cityId/lordId **不变**；非法时 no-op。
- [x] 攻方胜（攻 > 守）：目标城 lordId→攻方、城粮 += provisions、后备兵随城易主；出征武将 cityId=目标城；原守军就地成俘虏。
- [x] 攻方败（攻 ≤ 守，含平局）：目标城不变；出征武将 cityId=目标城并就地成俘虏；provisions 已损失。
- [x] 守方兵力口径：含目标城归属方武将兵 + 后备兵，**排除城内已有俘虏**。
- [x] `isCaptive` 派生正确；`officersInCity(onlyAvailable)` 排除俘虏。
- [x] 重选君主：守方君主被俘且仍有城→新君主=剩余未被俘武将中智力最高者，其余城与未被俘武将改归之，被俘者不改归属。
- [x] 灭亡：君主被俘且已无城→无新君主、剩余皆俘虏。
- [x] 攻方君主随军且战败→攻方君主成俘虏并触发其势力重选/灭亡。
- [x] 月末顺序：队列内掠夺先于出征执行（两趟）；出征结算先于收粮/收税（endMonth 编排）。
- [x] `endMonth` 整段推进：出征武将月末 busy→false 且体力恢复但 cityId=结算后城；既有经营/掠夺/侦察/收粮收税/跨年不受影响；同种子可复现（不耗 RNG）。

## 新建文件

- `src/core/world/adjacency.ts`：城邻接值对象 + `areAdjacent`。
- `src/core/economy/campaign.ts`：出征下令阶段（`canCampaign`/`campaign`）。
- `src/core/military/campaign.ts`：出征战斗结算（`executeCampaign`）+ 内联战斗 + 兵力统计助手。
- `src/core/world/succession.ts`：被俘君主重选/灭亡。
- 对应 `*.test.ts`（同级）：`world/adjacency.test.ts`、`economy/campaign.test.ts`、`military/campaign.test.ts`、`world/succession.test.ts`。

## 修改文件

- `src/core/game-state.ts`：`GameState` 增 `adjacency`；`PendingCommand` 并集加 `campaign` 分支。
- `src/core/game.ts`：`Action` 加 `campaign`；`canApply/apply` 分派到 `economy/campaign` 的 `canCampaign`/`campaign`。
- `src/core/world/queries.ts`：加 `isCaptive`；`officersInCity(onlyAvailable)` 排除俘虏。
- `src/core/turn/pending.ts`：加 `campaign` 分派到 `military/campaign` 的 `executeCampaign`，并按"非 campaign 先、campaign 后"两趟执行。
- `src/core/world/fixture.ts`：`createInitialState` 播种 `adjacency`（边：成都-江陵、江陵-许昌、许昌-邺城，保证刘备江陵与曹操许昌相邻可攻）。
- `src/core/world/city.ts`：加 `spendFood`（镜像 `spendGold`，供出征下令扣本城粮）。

## 任务清单

- [x] `world/adjacency.ts`：值对象 + `buildAdjacency`/`areAdjacent`（红绿）。
- [x] `game-state.ts` 加 `adjacency` 字段、`fixture.ts` 播种边，既有测试与构造编译通过。
- [x] `world/queries.ts` 加 `isCaptive` 并改 `officersInCity`（红绿，含俘虏排除）。
- [x] `economy/campaign.ts` `canCampaign`（红绿，覆盖各前置）。
- [x] `economy/campaign.ts` `campaign` 下令（红绿）。
- [x] `military/campaign.ts` `executeCampaign` 战斗+移动+占领（红绿，胜/败/平局/守方排俘虏）。
- [x] `world/succession.ts` `resolveSuccession`（红绿，重选/灭亡/攻方君主战败被俘）。
- [x] `game.ts` 接 `Action`、`pending.ts` 接 `campaign` 两趟执行（红绿）。
- [x] `endMonth` 端到端整段推进测试（顺序、可复现、既有流程不回归）。

## TDD：是

## 风险 / 待定

- **同月多支出征打同一目标城**：月末按入队序逐条基于当时状态结算，连锁结果（如第二支打的城已被第一支占领）不专门处理，仅保证不崩——留边界。
- **同一出征里 officerIds 重复**：`canCampaign` 需去重/查重，重复即判非法。
- **重选君主平局**：同智力取 id 字典序最小，保确定性。
- **adjacency 进 state** 会进存档/快照；属静态拓扑、可接受。
- **多将归属校验**（只能指挥自己的将）属未来 store 派发口（注入 playerLordId 校验每个 officer.lordId），本切片不在 core 做（actor-agnostic）。

# AGENTS

开发前必读 [CONSTITUTION.md](CONSTITUTION.md)（项目总纲）与 [CONTEXT.md](CONTEXT.md)（术语，若已存在）。
所有开发按 `specs/NN-<feature>/` 下的 `prd.md` 与 `dev.md` 约束进行，不要绕过文档直接堆代码。

## 架构红线
- 依赖方向单向：`ui → store → core`。
- `src/core/` 为纯 TS，禁止 import React / Zustand / 任何 UI。
- 游戏规则只写在 `core`；`store` 只做状态/存档；`ui` 只渲染与派发 action。
- `core` 内部按限界上下文组织（world / economy / military / turn / ai / shared），采用 **DDD-lite（函数式）**：聚合=数据类型+纯函数、值对象、领域服务、统一语言。
- 不引入仓储/应用层/事件总线/实体 class；YAGNI，出现真实需求前不提前抽象。
- 跨上下文协调只走 `core/game.ts` 的 `apply` 总入口委派；上下文之间不互相深耦合。
- 指令分「校验/变更」两段：`canX` 返回统一的 `CommandCheck`（`shared/command.ts`，`{ok, reason}`），`X` 执行变更且非法即 no-op；`game.canApply/apply` 按 Action 分派委派给各领域服务。
- 占人指令只传 `officerId`（不传 `cityId`）：作用城 = `officer.cityId`（单一真相源）。`scout` 例外，额外带真输入 `targetCityId`（被侦察的敌城）。
- 归属（只能指挥自己的将）不在 `core` 校验：`apply` 保持极简、actor-agnostic。行动方身份属入口的环境约束——玩家走 `store` 派发口（注入 `playerLordId`，校验 `officer.lordId === state.playerLordId`），AI 只对自己麾下武将造 action。`lordId` 不作为 Action 字段（单机无信任边界，传了也可伪造）。
- 占人统一用 `Officer.busy`（横切所有占人指令，月末回城）。**效果延到月末执行**的指令进 `GameState.pendingCommands`（带 `type` 的判别式并集），由 `turn` 层按 `type` 分派执行（与 `game.apply` 同构）；效果即时的指令不入队。月末顺序固定：`pendingCommands → settle（收粮/收税）→ 回城+体力恢复 → 月份+1`。`pendingCommands` 内部两趟执行：先所有非 `campaign`（掠夺等）按入队序，再所有 `campaign`（出征）按入队序。
- **俘虏为派生状态、不存字段**：`officer.lordId !== 所在城.lordId` 即俘虏（`world/queries.isCaptive`）。"在任武将"（`officersInCity(onlyAvailable)`）排除俘虏；占领只改 `city.lordId`，守军原地自动成俘虏。出征是占人例外：武将月末不回出发城（胜进驻新城/败成俘虏停留敌城，`cityId` 由 `executeCampaign` 改写，turn 层无特例）。
- **城邻接拓扑放 `GameState.adjacency`**（值对象，fixture 播种）：非全局常量、不进 config，使 `apply/canApply` 签名不变、可注入测试、随存档序列化。
- **道具加成只经 `queries.effectiveOfficer` 收敛**：道具对武力/智力的加成是派生，不写回 `Officer` 存储字段。所有用到武力/智力的公式（带兵量、开垦/招商增量、掠夺产出、重选君主智力比较）输入一律取 `effectiveOfficer(state, officerId)`，`troopCapacity(o)` 等纯公式签名不变。新增此类公式时同样吃有效值。
- **武将忠诚派生君主恒 100**：`Officer.loyalty` 为存储字段，但对外读取走 `queries.officerLoyalty`——君主（`officer.lordId===officer.id`）恒返回 100（即便经重选君主换人也成立），赏赐/没收对君主跳过写入。
- **即时·不占人指令**：赏赐/没收（及分配）效果在下令瞬间结算，**不入 `pendingCommands`、不置 `Officer.busy`、不耗 RNG**，且**不校验 busy**（君主对武将下令，武将本月仍可被其他指令占用）。归属（己方）校验同样不在 `core`，留 store 派发口。
- **下令 vs 战斗结算分上下文**：所有指令的**下令阶段**（`canX`/`X`：校验、扣本城资源、占人、入队）归 `economy/`，形态一致、与指令面板对应；**战斗的战中/战后结算**（出征 `executeCampaign`：战斗、占领、俘虏，调用 `world/succession` 重选君主）归 `military/`。两半经 `game.apply`、`turn/pending` 两个既有分派点接线，互不 import。经营领域的月末执行（掠夺破坏本城、收粮收税）仍就近留 `economy/`。

## 流程
spec-init → spec-prd（PRD）→ spec-dev（开发文档+质量自检）→ spec-build（实现）→ spec-refactor（重构）

## 功能列表

| 功能 | PRD | 开发文档 | 状态 |
|------|-----|---------|------|
| 经营循环 economy-loop | specs/01-economy-loop/prd.md | specs/01-economy-loop/dev.md | done |
| 兵力系统 troops | specs/02-troops/prd.md | specs/02-troops/dev.md | done |
| 掠夺/侦察 plunder-scout | specs/03-plunder-scout/prd.md | specs/03-plunder-scout/dev.md | done |
| 出征 campaign | specs/04-campaign/prd.md | specs/04-campaign/dev.md | done |
| 道具系统 items | specs/05-items/prd.md | specs/05-items/dev.md | done |

状态：draft（写 PRD 中）→ ready（开发文档已批准）→ done（已实现）

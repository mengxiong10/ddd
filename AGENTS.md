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
- 占人统一用 `Officer.busy`（横切所有占人指令，月末回城）。**效果延到月末执行**的指令进 `GameState.pendingCommands`（带 `type` 的判别式并集），由 `turn` 层按 `type` 分派执行（与 `game.apply` 同构）；效果即时的指令不入队。月末顺序固定：`pendingCommands → settle（收粮/收税）→ 回城+体力恢复 → 月份+1`。

## 流程
spec-init → spec-prd（PRD）→ spec-dev（开发文档+质量自检）→ spec-build（实现）→ spec-refactor（重构）

## 功能列表

| 功能 | PRD | 开发文档 | 状态 |
|------|-----|---------|------|
| 经营循环 economy-loop | specs/01-economy-loop/prd.md | specs/01-economy-loop/dev.md | done |
| 兵力系统 troops | specs/02-troops/prd.md | specs/02-troops/dev.md | done |
| 掠夺/侦察 plunder-scout | specs/03-plunder-scout/prd.md | specs/03-plunder-scout/dev.md | done |

状态：draft（写 PRD 中）→ ready（开发文档已批准）→ done（已实现）

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

## 流程
spec-init → spec-prd（PRD）→ spec-dev（开发文档+质量自检）→ spec-build（实现）→ spec-refactor（重构）

## 功能列表

| 功能 | PRD | 开发文档 | 状态 |
|------|-----|---------|------|
| 经营循环 economy-loop | specs/01-economy-loop/prd.md | specs/01-economy-loop/dev.md | done |

状态：draft（写 PRD 中）→ ready（开发文档已批准）→ done（已实现）

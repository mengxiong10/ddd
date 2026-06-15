---
name: spec-refactor
description: After finishing a large feature or accumulating several features, run a deep cross-feature refactor pass — extract common logic, deepen modules, reduce change amplification and duplication — without changing external behavior, in small steps that keep tests green. For solo, spec-driven development. Use when the user mentions 重构, 抽取公共逻辑, deep module, 可维护性, 技术债, 改动放大, refactor.
---

# spec-refactor — 跨功能深度重构评估

在做完一个大功能或积累多个功能后，做一次跨功能的深度重构，提升整体可维护性。**不改外部行为。**

## 第一原则

- 单人开发，可维护性第一、文件与抽象最少。
- 只有当抽象确实**降低未来改动成本**时才抽；否则保持简单直白（YAGNI）。
- 目标是**降低改动放大**：让以后改功能时波及面更小。

## 项目布局约定

```
<project>/
├── CONSTITUTION.md   # 总纲（约定演进时同步更新）
├── CONTEXT.md        # 术语表（术语变化时同步更新）
├── AGENTS.md         # 文档地图
└── specs/NN-<feature>/   # 两位序号前缀（01、02…）；内含 prd.md / dev.md
```

## 流程

### 1. 读上下文

读 `CONSTITUTION.md`、`CONTEXT.md`、`AGENTS.md` 与相关代码，了解现状与约定。

### 2. 列候选重构点并排序

找出可改进处（重复逻辑、浅模块、职责泄漏、改动放大点、循环依赖等），按"**可维护性收益 vs 风险**"排序，与用户确认要做哪些、不做哪些。
不合理或收益不明的重构主动劝退，不无脑附和。

### 3. 小步重构

- 一次一个改动，每步跑测试保持绿。
- 行为不变——不顺手加功能、不改对外契约。
- 优先：抽取公共逻辑、深化模块（小接口、深实现）、消除重复、收紧依赖方向。

### 4. 收尾

- 不新增多余文件/抽象；能并入已有文件就并入。
- 决策升级：重构沉淀出的项目级决策升级到唯一真源——约定/架构→`CONSTITUTION.md`、跨功能红线→`AGENTS.md`、术语→`CONTEXT.md`，让后续功能自动继承。
- 重构改动了某功能的接口/职责时，回写对应 `dev.md` 保持文档与代码一致。

---
name: spec-build
description: Implement a feature by following its approved specs/<feature>/dev.md — running a TDD red-green loop when chosen (one test, one minimal impl, repeat), checking off the task list, doing a lightweight refactor pass, and syncing status in AGENTS.md. For solo, spec-driven development. Use when the user wants to implement/build a feature from its dev doc, or mentions 实施, 开始开发, 写代码, build.
---

# spec-build — 按开发文档实施

读 `specs/NN-<feature>/dev.md`，把计划变成可运行、已测试、可维护的代码。

## 第一原则

- 单人开发，可维护性第一、文件与抽象最少。
- 代码简单直白优先，不提前抽象、不加投机功能、不建多余文件；**新建文件前先看能否放进已有文件**。
- 先遵守 `CONSTITUTION.md`，再遵守 `dev.md`。

## 项目布局约定

```
<project>/
├── CONSTITUTION.md   # 总纲（最高约束）
├── AGENTS.md         # 文档地图（本 skill 同步状态）
└── specs/NN-<feature>/     # 两位序号前缀（01、02…）方便排序
    ├── prd.md
    └── dev.md        # 本 skill 的输入与进度勾选处
```

## 前置

- 确认 `dev.md` 状态为 `ready`（已通过 spec-dev 的质量自检并被批准）。若仍是 `draft`，先回到 spec-dev。
- 读上下文沿用既有决策：`CONSTITUTION.md`、`AGENTS.md`（架构红线）、`CONTEXT.md`（术语），以及所依赖前序功能的代码——复用既有接口/类型/命名，不另起一套。

## 流程

### 1. 实施任务清单

读 `dev.md` 的任务清单，逐条**纵切**实现（端到端可验证），不要按层批量铺开。

**TDD = 是**（对齐已装 `tdd`）：

```
RED:   写一个测试 → 失败
GREEN: 写最小代码让它过 → 通过
重复下一条
```

- 一次一个测试，只写够过当前测试的代码，不预判后续测试。
- 测可观察行为，不测实现细节。禁止一次写完所有测试。

**TDD = 否**：先实现关键路径，再为 `dev.md` 列出的关键行为补少量高价值测试。

每完成一条任务，就在 `dev.md` 的任务清单里勾选。

### 2. 收尾轻量重构评估（对齐 tdd 的 Refactor 步骤）

本功能范围内：消除重复、抽小函数、收紧接口。每步小改并跑测试保持绿。
若发现需要跨功能的大重构，建议转 `spec-refactor`，不要在此硬塞。

### 3. 同步与一致性

- 全部完成后，在 `AGENTS.md` 把该 feature 状态置 `done`。
- 实施中若发现 PRD/方案需要改，回到 `dev.md` / `prd.md` 更新，而不是堆新文件或让代码偏离文档。
- 决策升级：实现中若定下会约束后续功能的项目级决策，升级到唯一真源（架构/约定→`CONSTITUTION.md`、跨功能红线→`AGENTS.md`、术语→`CONTEXT.md`），别只留在代码或本 `dev.md`。

---
name: spec-dev
description: Grill the technical approach for a feature that already has a PRD, then write an interface-level development doc to specs/<feature>/dev.md (behaviors to test, interface design, module responsibilities, files to create/modify, task checklist, TDD on/off), and run a maintainability quality self-check before approval. For solo, spec-driven development. Use when the user wants a dev plan, technical design, or mentions 开发文档, 技术方案, 设计接口, dev doc.
---

# spec-dev — 开发文档（接口级，先 grill 再设计）

在已有 PRD 的基础上，grill 技术方案，产出**接口级**开发文档 `specs/NN-<feature>/dev.md`。它是"动手前先想清楚 + 可评审的契约"，**刻意不写函数体**（写了代码很快过时）。

## 第一原则

- 单人开发，可维护性第一、文件与抽象最少。
- **低改动放大**：以"未来改这类需求时只动少数地方"为目标设计接口与模块边界。
- **grill 时会挑战、不当应声虫**：方案过度设计、会放大改动面、与总纲冲突时，主动挑战并给更简方案。

## 项目布局约定

```
<project>/
├── CONSTITUTION.md   # 总纲（遵循其技术栈/约定/默认 TDD 设定）
├── CONTEXT.md        # 术语表
├── AGENTS.md         # 文档地图（本 skill 登记 dev 链接）
└── specs/NN-<feature>/     # 两位序号前缀（01、02…）方便排序
    ├── prd.md        # 本 skill 的输入
    └── dev.md        # 本 skill 生成
```

## 流程

### 1. 读上下文（沿用既有决策）

为了让本功能站在前面功能的决策之上，按顺序读：

- `CONSTITUTION.md`：技术栈/架构/约定/默认是否 TDD。
- `AGENTS.md`：架构红线 + 功能列表（看已有哪些功能、状态如何）。
- `CONTEXT.md`：统一语言/术语——复用既有术语与精确语义，不重造词。
- 对应 `prd.md`。
- **所依赖或延续的前序功能的 `dev.md`**（接口设计/模块职责/关键设计取舍）+ 这些功能的相关已有代码——复用既有接口、类型、命名与模块边界，而不是另起一套。

### 2. grill 技术方案（一次一个，给推荐答案）

- 逐个确认接口/模块划分、是否 TDD、关键边界与数据流。
- 优先抽出可独立测试的"深模块"（小接口、深实现）。
- 方案过度或会放大改动面时主动挑战并给更简方案，不无脑附和。

### 3. 写 `specs/NN-<feature>/dev.md`（接口级粒度）

写进对应 PRD 所在的功能目录（同一个 `NN-<feature>`）。

能审质量、又不会过时——**只写签名不写实现体**。

```markdown
# <feature> 开发文档

## 方案概述

[几句话 + 关键设计取舍]

## 接口设计

[核心函数/组件的签名：名字、入参、返回类型；关键 type/状态形状；依赖方向。只写签名不写实现体]

## 模块职责

- <模块/文件>：负责什么、边界在哪、依赖谁

## 要测的行为

[关键行为清单（不是实现步骤）。TDD 时作为红绿循环的驱动清单]

- [ ] 行为 1
- [ ] 行为 2

## 新建文件

- `path/to/file`：一句话用途

## 修改文件

- `path/to/file`：改什么

## 任务清单

[纵切（tracer bullet）的可勾选清单，每条端到端可验证]

- [ ] 任务 1
- [ ] 任务 2

## TDD：是 / 否

## 风险 / 待定
```

避免文件海：每个 feature 只 `prd.md` + `dev.md`；测试只列关键路径；不为每个测试单独建 spec。

### 4. 质量自检（闸门：批准后才进 spec-build）

写完后按下表自检，把结论摆给用户；发现隐患先改 `dev.md` 再请用户确认。

- 接口是否最小、自解释？命名是否清晰？
- 模块是否够"深"、职责单一、无 god 模块？
- 预想的未来变化是否只动一处（低改动放大）？
- 有无提前抽象 / 投机通用化（YAGNI）？
- 数据模型是否无冗余状态、贴合领域？
- 新代码是否本可复用已有模块？
- 要测的行为是否覆盖关键路径，且测的是行为而非实现？
- 依赖方向是否健康（无循环、UI 不直接依赖底层细节）？

### 5. 决策升级（让后续功能自动继承）

判断本功能中产生的决策的作用域，放到唯一真源，避免被埋在单个 `dev.md` 里导致后续功能看不到：

- **架构/技术/代码约定**（会约束所有功能）→ 升级到 `CONSTITUTION.md`。
- **跨功能不变量/红线**（如依赖方向、命名规范、统一的 action/类型形状）→ 升级到 `AGENTS.md` 的「架构红线」。
- **术语/统一语言** → 升级到 `CONTEXT.md`。
- **仅本功能的局部决策** → 留在本 `dev.md`。

只有真正项目级、会影响后续功能的决策才升级；功能局部的不要往上塞，保持根文件精简。

### 6. 收尾

在 `AGENTS.md` 登记 dev 链接，状态置 `ready`。

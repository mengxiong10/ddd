---
name: spec-init
description: Bootstrap a project for spec-driven solo development. Grill the user about goals, tech stack, principles and conventions, then generate a root CONSTITUTION.md (project charter, like spec-kit constitution) and AGENTS.md (doc map), and scaffold specs/. Use as step 0 of a new project, or when the user mentions 新项目, 初始化, constitution, 总纲, 项目基调, project charter, or spec init.
---

# spec-init — 项目第 0 步：总纲 + 文档地图

这套 spec 驱动流程的第一步。面向**单人开发**，先和用户聊清项目基调，再生成根级 `CONSTITUTION.md`（总纲）和 `AGENTS.md`（文档地图），并建立 `specs/` 目录。

## 第一原则（所有 spec-\* skill 共用）

- 面向单人开发，不为多人协作做让步。**可维护性第一、文件最少、抽象最少。**
- 代码简单直白胜过聪明抽象；除非真有重复或复杂度，否则不提前抽象（YAGNI）。
- 低改动放大：用 deep modules（小接口、深实现）组织代码，让以后改功能时波及面最小。
- **grill 时会挑战、不当应声虫**：需求/选型不合理、自相矛盾、过度设计时，明确指出问题、说明理由、给替代方案。用户坚持时可保留并记为待定决策，但必须先把异议讲清楚。

## 项目布局约定

```
<project>/
├── CONSTITUTION.md   # 总纲：目标/技术栈/原则/约定/质量线（本 skill 生成）
├── CONTEXT.md        # 术语表（懒创建：第一个术语出现时由 spec-prd 建）
├── AGENTS.md         # 文档地图，AI 每次自动读（本 skill 生成）
└── specs/
    └── NN-<feature>/        # 两位序号前缀（01、02…）方便排序
        ├── prd.md    # 由 spec-prd 生成
        └── dev.md    # 由 spec-dev 生成
```

## 流程

### 1. grill 项目基调（一次只问一个，每问给推荐答案）

参考 `grill-with-docs` 风格，逐个澄清：

- 项目目标与范围：要解决什么问题，第一版做到哪、不做什么
- 技术栈与框架：语言、框架、构建/包管理、关键库
- 代码与目录约定：目录结构、命名、组件/模块组织方式
- 测试与质量线：测什么、测到什么程度，**默认是否 TDD**
- 范围边界：明确不做的事

挑战不合理之处：技术选型矛盾、约定过重、范围过大时，先质疑再继续。达成一致前不落盘。

### 2. 写 `CONSTITUTION.md`

开头固定写明最高原则，再填各节。保持精简，只写强约束，不堆细节。

```markdown
# 项目总纲（CONSTITUTION）

## 最高原则

单人开发；可维护性第一；文件与抽象最少；低改动放大；不提前抽象（YAGNI）。

## 项目目标

[一两句：解决什么问题，给谁用]

## 技术栈

- 语言/框架：
- 构建/包管理：
- 关键库：

## 开发原则

- [少量、强约束的规则，例如：组件无副作用、状态集中管理…]

## 代码与目录约定

- 目录结构：
- 命名：
- 模块/组件组织：

## 测试与质量线

- 默认 TDD：是/否
- 测什么：关键行为/核心逻辑（少而精，不追覆盖率）

## 范围边界

- 不做：
```

### 3. 写 `AGENTS.md`（文档地图）

```markdown
# AGENTS

开发前必读 [CONSTITUTION.md](CONSTITUTION.md)（项目总纲）与 [CONTEXT.md](CONTEXT.md)（术语，若已存在）。
所有开发按 specs/NN-<feature>/ 下的 prd.md 与 dev.md 约束进行，不要绕过文档直接堆代码。

## 流程

spec-init → spec-prd（PRD）→ spec-dev（开发文档+质量自检）→ spec-build（实现）→ spec-refactor（重构）

## 功能列表

| 功能   | PRD                  | 开发文档             | 状态  |
| ------ | -------------------- | -------------------- | ----- |
| (示例) | specs/01-示例/prd.md | specs/01-示例/dev.md | draft |

状态：draft（写 PRD 中）→ ready（开发文档已批准）→ done（已实现）
```

### 4. 建立 `specs/` 目录

创建空 `specs/` 目录（首个功能由 spec-prd 填充，功能目录用 `NN-<feature>` 两位序号前缀方便排序）。`CONTEXT.md` 不在此创建，等第一个术语出现时由 spec-prd 懒创建。

## 注意

- 若 `CONSTITUTION.md` / `AGENTS.md` 已存在，只做增量更新，不覆盖。
- 不要创建本约定之外的额外文件，避免文件海。

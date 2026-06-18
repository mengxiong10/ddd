---
name: spec-prd
description: Grill the user about a feature's requirements, then write a lightweight PRD to specs/<feature>/prd.md and maintain the root CONTEXT.md glossary and AGENTS.md doc map. For solo, spec-driven development. Use when the user wants to write a PRD, capture product requirements, start a 新功能, or mentions 写 PRD, 产品需求, spec.
---

# spec-prd — 精简 PRD（先 grill，再落文档）

把一个功能的需求和用户聊清楚，再写一份**精简** PRD 到 `specs/NN-<feature>/prd.md`。面向单人开发，可维护性第一、文件最少。

## 第一原则

- 单人开发，可维护性第一、文件与抽象最少。
- **grill 时会挑战、不当应声虫**：需求不合理、过度、自相矛盾，或与 `CONSTITUTION.md`/`CONTEXT.md`/现有代码冲突时，先指出问题、说明理由、给替代方案，再继续。
- 砍掉多人协作仪式：不写超长用户故事列表、不做 issue 拆分。

## 项目布局约定

```
<project>/
├── CONSTITUTION.md   # 总纲（spec-init 生成）
├── CONTEXT.md        # 术语表（本 skill 懒创建/维护）
├── AGENTS.md         # 文档地图（本 skill 登记）
└── specs/NN-<feature>/     # 两位序号前缀（01、02…）方便排序
    ├── prd.md        # 本 skill 生成
    └── dev.md        # 由 spec-dev 生成
```

## 前置检查

若缺 `CONSTITUTION.md` 或 `AGENTS.md`，提示用户先跑 `spec-init`，不要在没有总纲的情况下硬写 PRD。

## 流程

### 1. 读上下文

先读 `CONSTITUTION.md`、`CONTEXT.md`（若有）、`AGENTS.md` 和相关代码，确保 PRD 符合项目基调与既有术语。

### 2. grill 需求（参考 grill-with-docs）

- 一次只问一个问题，每个问题给推荐答案。
- 遇到与术语表冲突或模糊词，当场澄清并统一用词。
- 需求不合理/过度/矛盾时主动挑战并给替代方案，不无脑附和。
- 达成一致前不写 PRD。

### 3. 写 `specs/NN-<feature>/prd.md`

先确定功能目录名：扫描 `specs/` 下已有目录，取最大的两位序号 + 1（没有则从 `01` 开始），零填充为两位，拼成 `NN-<feature>`（如 `01-login`、`02-cart`）。`<feature>` 用简短英文 kebab-case。

模板（远小于通用 PRD，单人向，够用即停）：

```markdown
# <feature> PRD

## 问题

[从用户视角，要解决什么问题]

## 目标

[做成什么样算成功，一两句]

## 关键行为 / 用户故事

[3-7 条短清单，够用就停，不强求超长]

1. 作为 <角色>，我要 <能力>，以便 <收益>

## 范围 & 不做

- 做：
- 不做：

## 验收标准

- [ ] 标准 1
- [ ] 标准 2

## 待定决策

[grill 中保留的分歧或未定项；没有就写"暂无"]
```

不放文件路径和代码（那是 dev.md 的事，且会过时）。

### 4. 收尾

- 把新术语写进 `CONTEXT.md`（仅 glossary，无实现细节）；若 `CONTEXT.md` 不存在则此时创建。
- 在 `AGENTS.md` 功能列表登记该 feature（prd 链接，状态 `draft`）。

## CONTEXT.md 术语表格式

```markdown
# CONTEXT（术语表）

- **<术语>**：<精确定义>。[与易混词的区别（如有）]
```

只放术语定义，不当作 spec、草稿或实现决策的存放处。

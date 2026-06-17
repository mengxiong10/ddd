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
- **俘虏为派生状态、不存字段**：`officer.lordId !== 所在城.lordId` 即俘虏（`world/queries.isCaptive`）。"在任武将"（`officersInCity(onlyAvailable)`）排除俘虏；占领只改 `city.lordId`，守军原地自动成俘虏。**占人例外（武将月末不回出发城）**：出征——胜进驻新城/败成俘虏停留敌城（`cityId` 由 `executeCampaign` 改写）；移动——月末落到目标己方城（`cityId` 由 `executeMove` 改写）。两者 `cityId` 均由月末执行改写、turn 层无特例。`pendingCommands` 非 campaign 趟含掠夺/移动/输送，campaign 趟含出征。
- **城邻接拓扑放 `GameState.adjacency`**（值对象，fixture 播种）：非全局常量、不进 config，使 `apply/canApply` 签名不变、可注入测试、随存档序列化。
- **道具加成只经 `queries.effectiveOfficer` 收敛**：道具对武力/智力的加成是派生，不写回 `Officer` 存储字段。所有用到武力/智力的公式（带兵量、开垦/招商增量、掠夺产出、重选君主智力比较）输入一律取 `effectiveOfficer(state, officerId)`，`troopCapacity(o)` 等纯公式签名不变。新增此类公式时同样吃有效值。
- **武将忠诚派生君主恒 100**：`Officer.loyalty` 为存储字段，但对外读取走 `queries.officerLoyalty`——君主（`officer.lordId===officer.id`）恒返回 100（即便经重选君主换人也成立），赏赐/没收对君主跳过写入。
- **即时·不占人指令**：赏赐/没收（及分配）效果在下令瞬间结算，**不入 `pendingCommands`、不置 `Officer.busy`、不耗 RNG**，且**不校验 busy**（君主对武将下令，武将本月仍可被其他指令占用）。归属（己方）校验同样不在 `core`，留 store 派发口。
- **登场/在野/未发现（`06-debut-search`）**：未登场武将/道具存 `GameState.pendingDebuts`（独立池，**不进** `officers`/`items`），**登场为运行时月末事件**——`world/debut.runDebuts` 在月末「月份+1」**之后**按新年份判定（`year ≥ debutYear`），选城（指定城或全部城随机、消耗 RNG）后物化进 `officers`/`items` 并出池。月末固定顺序因此扩展为 `pendingCommands → settle → 回城+体力恢复 → 月份+1 → 登场`。池条目用 `Omit<Officer,'cityId'>`/`Omit<Item,'holder'>` 表达「除落城外全量」，**不放宽** `cityId`/`holder` 类型（活代码零改动）。`Officer.lordId` 可空，`null`=**无主**（统一覆盖未登场/在野）；在野武将（活在 `officers`、`lordId===null`）不进在任、不参与守城、不被指令指派、非俘虏，仅可经**搜寻**招募（`isCaptive`/`officersInCity` 加 `null` 守卫）。道具新增 `discovered`：未发现道具不可被赏赐。
- **性格单值双表解读**：`Officer.personality`（`0..4`）单存一处；君主表（和平/大义/奸诈/狂人/冒进）/普通武将表（忠义/大志/贪财/怕死/卤莽）由 `lordId===id` 派生切换、不另存第二份；重选君主后新君主自动改用君主表解读其原值。文字标签属 UI，不入 core。
- **无己方执行人的处置类指令归属口径**：处斩/流放（目标可能是敌方俘虏，无己方执行人）按**作用城归属**（`city.lordId===playerLordId`）在 store 派发口校验，区别于占人指令按执行人归属（`officer.lordId===playerLordId`）；`core` 仍 actor-agnostic、不校验归属。
- **下令 vs 战斗结算分上下文**：所有指令的**下令阶段**（`canX`/`X`：校验、扣本城资源、占人、入队）归 `economy/`，形态一致、与指令面板对应；**战斗的战中/战后结算**（出征 `executeCampaign`：战斗、占领、俘虏，调用 `world/succession` 重选君主）归 `military/`。两半经 `game.apply`、`turn/pending` 两个既有分派点接线，互不 import。经营领域的月末执行（掠夺破坏本城、收粮收税）仍就近留 `economy/`。
- **城状态自治月末事件归 `world/`（`09-city-disaster`）**：灾害破坏/生成/恢复**不挂在任何玩家指令上**、只读写 `City` 的状态/防灾值/资源字段，故归 `world/disaster.runDisasters`，区别于「挂在指令延后效果上的月末执行（掠夺破坏/收粮收税）就近留 `economy/`」。判据：月末某段逻辑是否是某条玩家指令的延后效果——是→economy，否（城状态自治）→world。`City.status`（`'normal'|'famine'|'drought'|'flood'|'riot'`）与 `disasterPrevention` 为不可派生的城自治真相、必存；破坏的逐字段变换（`applyDisasterDamage`）与 `ravage` 同位收敛在 `world/city.ts`，`disaster.ts` 只管 RNG 判定与按城（id 升序）遍历编排。月末固定顺序**纯追加**为 `pendingCommands → settle → 回城+体力恢复 → 月份+1 → 登场 → 灾害（runDisasters）`，不挪动既有步骤、不改 6/10 收粮与 3/6/9/12 收税日历。治理指令的下令阶段照旧归 `economy/govern`。
- **外交指令归经营·月末（`10-diplomacy`）**：招揽/离间/策反/劝降四条 `占人 ✓ · 效果=月末`，下令阶段与月末执行（含 territorial `lordId`/`cityId` 改写）就近收敛于 `economy/diplomacy.ts`，沿用招降在 economy 改归属的先例，**不**触 `military`/`world/succession`。目标用 `targetOfficerId`（敌方武将/太守/君主），`PendingCommand`/`Action` 四分支同形。招揽/离间/策反共用三关（智力差→忠诚→性格，内部 `runThreeGates` 去重）、劝降另套关（城池压制+智力差+君主性格、无忠诚关）。
- **太守为派生（`world/queries.governorOf`，`10-diplomacy`）**：某城太守 = 君主正驻该城则为君主、否则本城在任武将中有效智力最高者（平局取 id 最小）；零存储字段。策反目标须为**非君主太守** → 君主即太守时不可策反 → 分裂城永不含原君主 → **策反不触发重选君主**（结构上免除接 succession）。
- **core actor-agnostic 的显式例外（`10-diplomacy`）**：劝降「玩家君主免疫」是**游戏规则**（非归属校验），`executeInduce` 显式读 `state.playerLordId`、目标为玩家君主即失败（防 AI 劝降玩家君主）。除此唯一例外外，`core` 不读 `playerLordId`、不校验归属。

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
| 登场与搜寻 debut-search | specs/06-debut-search/prd.md | specs/06-debut-search/dev.md | done |
| 城务指令 city-commands | specs/07-city-commands/prd.md | specs/07-city-commands/dev.md | done |
| 性格与俘虏流转 personality-captive | specs/08-personality-captive/prd.md | specs/08-personality-captive/dev.md | done |
| 城市灾害 city-disaster | specs/09-city-disaster/prd.md | specs/09-city-disaster/dev.md | done |
| 外交 diplomacy | specs/10-diplomacy/prd.md | specs/10-diplomacy/dev.md | done |

状态：draft（写 PRD 中）→ ready（开发文档已批准）→ done（已实现）

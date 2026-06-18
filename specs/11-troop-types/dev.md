# troop-types（兵种系统）开发文档

## 方案概述

三块新东西，全部贴既有「基础存储 + 派生收敛」范式，把改动收敛到少数点：

- **兵种 = 基础存储 + 有效派生**。`Officer` 加**基础兵种** `troopType`（存储字段，fixture 播种、可信、不跑门槛）。`queries.effectiveTroopType(state, id)` 派生「有效兵种」——以基础兵种为起点，按所持道具的装备先后依次应用其改兵种结果、合法的后者覆盖前者。**不写回 Officer**，与 `effectiveOfficer`（有效武力/智力）完全同构；战斗等下游临场读取。
- **道具加两字段**：`movementBonus`（移动力加成）、`troopTypeOverride`（`0..3`，改兵种）。门槛（玄兵需有效智力 > 105、极兵需有效武力 > 105）在求有效兵种时用 `effectiveOfficer` 的有效值（已含该道具自身加成）实时判定。
- **装备顺序经 `holder` 加序号、不动归属模型**。保留 `ItemHolder` 判别式（属城 XOR 属将的结构安全性不变），officer 分支加 `equipSeq`；`itemsOfOfficer` 按 `equipSeq` 升序返回。**唯一**写 officer-holder 的路径是 `reward`，由它计算 `nextEquipSeq`——`holdByCity`/`discover`/`captive`/`debut`/`fixture`/`search`/按城查询全部不动。
- **移动力**：`queries.officerMovement(state, id)` = 有效兵种基础移动力 + 所持道具 `movementBonus` 之和，纯派生、仅展示，无任何下游规则。

本切片仅 core（项目尚无 store/ui，与既有切片一致）；面板展示与玩家归属校验留待 UI 层。

## 接口设计

### world/troop-type.ts（新建·兵种值对象 + 纯规则）

```ts
export type TroopType = 'cavalry' | 'infantry' | 'archer' | 'navy' | 'elite' | 'mystic'

// 道具改兵种字段：0 不改 / 1 水军 / 2 玄兵(智力>105) / 3 极兵(武力>105)
export type TroopTypeOverride = 0 | 1 | 2 | 3

// 各兵种基础移动力（规则身份，内联常量）：骑5 步4 弓4 水5 极6 玄3
export const BASE_MOVEMENT: Record<TroopType, number>

// 玄兵/极兵装备门槛（规则身份，内联常量），严格 > 105
export const ELITE_FORCE_REQUIREMENT = 105 // override=3 极兵：有效武力 > 105
export const MYSTIC_INTEL_REQUIREMENT = 105 // override=2 玄兵：有效智力 > 105

// 解析一件道具的改兵种结果（纯函数，不读 state）：
// override=0 → null（不改）；1 → 'navy'；2 → 智力门槛满足返 'mystic' 否则 null；3 → 武力门槛满足返 'elite' 否则 null。
export function resolveOverride(
  override: TroopTypeOverride,
  effForce: number,
  effIntel: number
): TroopType | null
```

### world/item.ts（修改·holder 加序号 + 两新字段）

```ts
export type ItemHolder =
  | { readonly kind: 'city'; readonly cityId: CityId }
  | { readonly kind: 'officer'; readonly officerId: OfficerId; readonly equipSeq: number } // 新增 equipSeq：装备先后

export interface Item {
  // …既有：id/name/forceBonus/intelBonus/holder/discovered/recruiterId…
  readonly movementBonus: number // 新增：移动力加成（整数）
  readonly troopTypeOverride: TroopTypeOverride // 新增：改兵种字段 0..3
}

// 归属改到某武将，带装备序号（默认 0，仅测试便利；reward 总传显式 nextEquipSeq）
export function holdByOfficer(item: Item, officerId: OfficerId, equipSeq?: number): Item
// holdByCity / discover 签名与行为不变
```

### world/officer.ts（修改）

```ts
export interface Officer {
  // …既有字段…
  readonly troopType: TroopType // 新增：基础兵种（fixture 播种，可信、不跑门槛）
}
```

### world/queries.ts（修改·新增两派生只读）

```ts
// itemsOfOfficer：在既有 holder 过滤后，按 holder.equipSeq 升序返回（装备先后）
export function itemsOfOfficer(state: GameState, officerId: OfficerId): Item[]

// 有效兵种：base=officer.troopType；按 itemsOfOfficer（已排序）逐件 resolveOverride，
// 门槛取 effectiveOfficer 的有效武力/智力（已含全部所持道具，包括该道具自身）；合法后者覆盖前者。
export function effectiveTroopType(state: GameState, officerId: OfficerId): TroopType

// 移动力（派生，仅展示）= BASE_MOVEMENT[effectiveTroopType] + Σ 所持道具 movementBonus
export function officerMovement(state: GameState, officerId: OfficerId): number
```

### economy/reward.ts（修改·赏赐装备时算序号）

```ts
// 计算某武将下一个装备序号（私有助手）：1 + 现有 officer-held 道具最大 equipSeq（无则 -1 ⇒ 首件为 0）
// reward 的 holdByOfficer 调用改为传 nextEquipSeq(state, officerId)；canReward 不变（仍校验 holder=城、未满 2 件）
```

## 模块职责

- `world/troop-type.ts`：兵种枚举 + 基础移动力表 + 门槛常量 + `resolveOverride` 纯规则；不依赖 state，纯数据与判定。
- `world/item.ts`：`ItemHolder` officer 分支加 `equipSeq`；`Item` 加 `movementBonus`/`troopTypeOverride`；`holdByOfficer` 带序号入参。
- `world/officer.ts`：`Officer` 加 `troopType` 基础兵种字段（无新函数，门槛/派生不在聚合内）。
- `world/queries.ts`：`itemsOfOfficer` 加排序；新增 `effectiveTroopType`（兵种派生唯一收敛处）、`officerMovement`（移动力派生）。
- `economy/reward.ts`：`reward` 计算并传 `equipSeq`；唯一写 officer-holder 的路径，序号语义本地内聚。
- `world/fixture.ts`：播种武将 `troopType`、道具 `movementBonus`/`troopTypeOverride`（含待登场池条目）。

## 要测的行为

- [x] `resolveOverride`：0→null；1→navy；2→智力>105 才 mystic，否则 null（=105 不通过，严格大于）；3→武力>105 才 elite，否则 null。
- [x] `BASE_MOVEMENT`：六种兵种移动力 = 5/4/4/5/6/3。
- [x] `effectiveTroopType`：无改兵种道具时 = 基础兵种；override=1 必改水军。
- [x] `effectiveTroopType` 门槛：玄兵/极兵道具在有效智力/武力（含该道具自身加成）>105 时生效，否则维持原兵种、道具仍佩戴。
- [x] `effectiveTroopType` 派生回退：没收改兵种道具、或没收使有效属性跌破阈值的加成道具后，有效兵种随之回退（纯派生、Officer.troopType 不变）。
- [x] `effectiveTroopType` 顺序：持 2 件改兵种道具时，`equipSeq` 较大者（后装备）的结果覆盖较小者。
- [x] `itemsOfOfficer`：按 `equipSeq` 升序返回。
- [x] `officerMovement` = 有效兵种基础移动力 + 所持道具 `movementBonus` 之和。
- [x] `reward`：连赏两件道具，`equipSeq` 递增（首件 0、次件 1）；既有赏赐/没收行为（归属转移、忠诚增减、君主豁免、no-op）不回归。
- [x] 既有全部测试编译通过、不回归（新增 Item/Officer 字段后构造体补齐）。

## 新建文件

- `src/core/world/troop-type.ts`：兵种值对象 + 基础移动力表 + 门槛常量 + `resolveOverride`。
- `src/core/world/troop-type.test.ts`：`resolveOverride` 与移动力表的关键路径。

## 修改文件

- `src/core/world/item.ts`：`ItemHolder` officer 分支加 `equipSeq`；`Item` 加 `movementBonus`/`troopTypeOverride`；`holdByOfficer` 带 `equipSeq?`。
- `src/core/world/officer.ts`：`Officer` 加 `troopType`。
- `src/core/world/queries.ts`：`itemsOfOfficer` 按 `equipSeq` 排序；加 `effectiveTroopType`/`officerMovement`。
- `src/core/economy/reward.ts`：`reward` 计算并传 `nextEquipSeq`。
- `src/core/world/fixture.ts`：`OfficerSeed`/`ItemSeed`/`DEBUT_*_SEEDS` 与对应构造体补 `troopType`/`movementBonus`/`troopTypeOverride`。
- `src/core/**/*.test.ts`：补齐新字段的 Item/Officer 构造体与含 officer-holder 的 `equipSeq`（`world/item.test.ts`、`economy/reward.test.ts`、`world/queries.test.ts`、`economy/search.test.ts`、`world/succession.test.ts`、`economy/plunder.test.ts` 等）。

## 任务清单

- [x] `world/troop-type.ts`：`TroopType`/`TroopTypeOverride`/`BASE_MOVEMENT`/门槛常量/`resolveOverride`（红绿）。
- [x] `world/item.ts` 加 `equipSeq`/`movementBonus`/`troopTypeOverride`、`holdByOfficer` 带序号；`world/officer.ts` 加 `troopType`；`fixture.ts` 播种，使既有测试与构造编译通过（红绿）。
- [x] `world/queries.ts`：`itemsOfOfficer` 排序 + `effectiveTroopType`（含门槛、顺序覆盖、回退）（红绿）。
- [x] `world/queries.ts`：`officerMovement`（红绿）。
- [x] `economy/reward.ts`：`nextEquipSeq` 并验证连赏序号递增、既有行为不回归（红绿）。

## TDD：是

## 质量自检

- 接口最小自解释：`effectiveTroopType`/`officerMovement` 与既有 `effectiveOfficer`/`officerLoyalty` 同构命名；`resolveOverride` 单一职责、纯函数。✅
- 深模块、职责单一：兵种规则收敛在 `troop-type.ts`（纯）+ `queries`（派生编排），不散落。✅
- 低改动放大：未来「再加一种改兵种道具/调门槛/调移动力」只动 `troop-type.ts`；归属模型零改动，officer-holder 写入只 `reward` 一处。✅
- 无提前抽象（YAGNI）：相克/水战/移动力作用本切片不实现；不建战棋、不加 AI 装备逻辑。✅
- 数据模型无冗余：兵种基础存一处、有效兵种与移动力均派生不写回；保留 `holder` 判别式的「属城 XOR 属将」结构安全，未引入手动同步不变量。✅
- 复用既有：派生范式同 `effectiveOfficer`；门槛吃有效值复用 `effectiveOfficer`；装备/卸下沿用赏赐/没收，不新增指令。✅
- 测行为非实现：清单针对门槛边界（=105 不过、>105 过）、顺序覆盖、派生回退、序号递增等状态结果。✅
- 依赖方向健康：`troop-type.ts` 零依赖；`officer.ts`/`item.ts` 仅引其类型；`queries` 编排；无循环、不涉 UI。✅

## 风险 / 待定

- **门槛只能靠道具突破**：基础武力 mock=50、智力≤100，无人天然 > 105，故极兵/玄兵在当前 fixture 下必须靠加成道具才能装备——符合「精英兵种」定位；具体平衡（基础兵种分布、道具加成/移动力数值）留待平衡阶段。
- **有效兵种用全量有效值判门槛**：门槛吃 `effectiveOfficer`（含该武将所持全部道具，不止当前这件）的有效武力/智力，与 PRD「含该道具自身加成」一致，但意味着「另一件加成道具」也会助推门槛——可接受的涌现。
- **战斗读取时机**：本切片无下游消费；后续战棋接入时在战斗开始前读 `effectiveTroopType`（派生、临场真值），不在本切片预埋。
- **store/ui 尚不存在**：兵种/移动力/道具新字段的面板展示留待 UI 层，与既有切片一致。

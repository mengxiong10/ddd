# original-scenarios 开发文档

## 方案概述

保留“离线静态规范化、运行时轻实例化”，但把生成结果拆成共享身份/基础目录、共享战斗地图与四份时期状态。原始时期编号只在生成器内部解释；运行时统一使用稳定数字 ID。`data/scenarios` 负责合并所有共享目录和时期状态，把七张地图作为 `GameState.battleMaps` 注入 core；core 不 import、枚举或加载具体地图数据。

删除 `DebutEntry` 与 `pendingDebuts`。本剧本全部武将/道具从开局起进入各自字典；位置为空是未登场的唯一真相源。`world/debut` 按实体 ID 扫描并填入位置。未登场武将装备从开局起直接持有，不需要同步物化协议。

## 接口设计

```ts
// core/shared/ids.ts
export type CityId = number
export type OfficerId = number
export type ItemId = number
export type BattleMapId = number

// core/world/appearance.ts
export interface AppearanceConditions {
  readonly birth: number
  readonly recruiterId: OfficerId | null
  readonly cityId: CityId | null
}

// core/world/officer.ts
export interface Officer {
  readonly id: OfficerId
  readonly name: string
  readonly cityId: CityId | null
  readonly appearanceConditions: AppearanceConditions
  // 其余既有字段
}

// core/world/item.ts
export type ItemHolder =
  | { readonly kind: 'city'; readonly cityId: CityId }
  | { readonly kind: 'officer'; readonly officerId: OfficerId; readonly equipSeq: number }

export interface Item {
  readonly id: ItemId
  readonly name: string
  readonly holder: ItemHolder | null
  readonly appearanceConditions: AppearanceConditions
  // discovered 与基础属性保持既有语义
}

// core/game-state.ts
export interface GameState {
  readonly cities: Readonly<Record<CityId, City>>
  readonly officers: Readonly<Record<OfficerId, Officer>>
  readonly items: Readonly<Record<ItemId, Item>>
  readonly battleMaps: BattleMapCatalog
  // 无 pendingDebuts
}

// core/world/debut.ts
export function runDebuts(state: GameState): GameState
```

`runDebuts` 先按 `OfficerId` 升序处理 `cityId=null && year>=birth+16` 的武将，再按 `ItemId` 升序处理 `holder=null && year>=birth` 的道具；指定城直接落城，空目标调用既有随机选城助手。持有未登场武将的道具不参与扫描。

```ts
// data/scenarios/index.ts（生成 JSON 内部接口）
interface IdentityRecord {
  readonly id: number
  readonly name: string
}
interface CityDefinition extends IdentityRecord {
  readonly x: number
  readonly y: number
  readonly battleMapId: BattleMapId
}
interface ItemDefinition {
  readonly id: ItemId
  readonly name: string
  readonly forceBonus: number
  readonly intelBonus: number
  readonly movementBonus: number
  readonly troopTypeOverride: TroopTypeOverride
}
interface PeriodData {
  readonly id: ScenarioId
  readonly name: string
  readonly startYear: number
  readonly cities: readonly CityPeriodState[]
  readonly officers: readonly OfficerPeriodState[]
  readonly items: readonly ItemPeriodState[]
}

export const SCENARIOS: readonly ScenarioSummary[]
export function lordsForScenario(scenarioId: ScenarioId): readonly ScenarioLordSummary[]
export function createScenarioState(request: CreateScenarioRequest): GameState
```

共享 `cities.json/officers.json/items.json/adjacency.json` 与时期数组只在 `scenario.ts` 内合并；UI/store 接口保持不变。

## 生成规则

- 城市 ID 直接使用原版 1..38；道具 ID 直接使用 `goods.json` 1..37。
- 武将身份按时期 1→4、时期内原始编号升序首次出现分配 1-based ID；同名复用，目录输出后按 ID 升序。
- 原始姓名先用于跨时期身份匹配，再由显式校订表输出规范姓名；姓名校订不重排或重分配数字 ID。
- 时期武将成员 = 城市队列中的非空武将 + `birth+16>startYear` 的未来非空武将；未来武将 `cityId=null`。
- `appearanceConditions` 必填，字段为 `{birth,recruiterId,cityId}`；0 引用转 null，引用转稳定项目 ID。
- 道具扫描顺序固定为完整原始 `goods_queue`，再按原始武将编号/槽位。以 `Set<ItemId>` 记已派发，重复项跳过，但原始装备槽仍参与基础属性还原。
- 已装备道具 holder 直接指向武将，包括未来武将；装备 `discovered=true`。城市队列道具保留高位发现标志。
- 共享目录只含静态字段；时期数组只含成员与可变/时期字段。
- 城目录从 `cities.city_positions` 与 `cities.city_map_ids` 合并 `x/y/battleMapId`；世界坐标不派生邻接，时期城市状态不再写 `battleMapId`。
- 仓库保存裁剪后的 `data/sgby-reset/battle-maps.json` 输入快照，只含七张地图的源 id、尺寸与 `terrain_tiles`；不长期依赖仓库外的 `~/dev/source`。
- 生成 `src/data/scenarios/generated/battle-maps.json`：地图 id 规范为 `1..7`，二维源地形转行主序 `Terrain[]`，`hill→mountain`，拒绝未知地形、非 `32×32`、非唯一 `city` 格。
- `data/scenarios/index.ts` 读取生成地形并调用 core 的纯构造函数，创建 `BattleMapCatalog` 注入 `GameState`；城池格直接由 `tiles` 中唯一的 `city` 判断，出生点在开战时按攻击方向和原版阵形表动态计算，均不写入源快照或 `BattleMap`。
- 删除 `plains` 占位模板与未知地图回退；fixture 使用地图 1，非法 `battleMapId` 作为数据错误显式失败。
- 所有输出先在内存完成计数、范围、重复和引用校验，再一次性格式化写出；`--check` 比较全部八份输出。

## 模块职责

- `scripts/scenarios/generate-original.mjs`：唯一原版格式解释器；分配稳定数字身份、去重道具、拆共享/时期数据、执行完整性校验。
- `data/sgby-reset/battle-maps.json`：从原版数据裁剪的七张纯地形输入快照，不含 tile 与图片资源。
- `src/data/scenarios/generated/battle-maps.json`：生成后的七张规范化地形矩阵，与其它剧本数据同属 data 层。
- `src/data/scenarios/generated/*.json`：禁止手改的共享目录、拓扑与时期状态。
- `src/data/scenarios/index.ts`：隐藏 JSON 形状，合并完整实体与战斗地图并创建 `GameState`；只向下依赖 core 类型和值对象。
- `src/core/world/appearance.ts`：共享登场条件值对象。
- `src/core/world/debut.ts`：只推进未登场实体的位置与 RNG。
- `src/core/world/queries.ts`：对 nullable `cityId/holder` 做统一守卫；不让未登场实体参与城市、俘虏、指令和战斗查询。
- 其它 core 模块：只把字符串比较/排序迁为数字升序，不引入第二排序键。

## 要测的行为

- [ ] 生成共享目录和四时期文件，ID/计数/引用符合 PRD，`--check` 能检测漂移。
- [ ] 武将 ID 跨时期稳定；城/道具沿用原版 ID；三类编号从 1 开始且各自独立。
- [ ] 四个已确认姓名校订进入共享目录，误写不再出现在运行时，稳定数字 ID 不变。
- [ ] 道具按首引用唯一化，保留位置与 PRD 一致，装备基础属性还原不受去重扫描影响。
- [ ] `createScenarioState` 合并目录与时期状态，相同请求深相等，非法君主抛错。
- [ ] 未来武将从开局起在 `officers`、装备从开局起在 `items`；未登场查询不可见。
- [ ] `runDebuts` 按武将后道具、各自数字 ID 升序推进，指定/随机城市与 RNG 可复现。
- [ ] 所有旧字符串 ID 排序改为数字升序；AI、灾害、战后、继承、战斗 AI 回归通过。
- [ ] 既有空城、兵种、store 和开局 UI 行为不回退。

## 新建文件

- `src/core/world/appearance.ts`：登场条件类型。
- `src/data/scenarios/generated/cities.json`：共享城市身份。
- `src/data/scenarios/generated/officers.json`：共享武将身份。
- `src/data/scenarios/generated/items.json`：共享道具基础资料。
- `src/data/scenarios/generated/adjacency.json`：共享邻接边。
- `src/data/scenarios/index.ts`：运行时剧本目录、数据合并与初始状态装配。

## 修改文件

- `scripts/scenarios/generate-original.mjs`：数字身份、共享输出、时期状态、首引用去重和新校验。
- `src/data/scenarios/generated/period-*.json`：仅保留时期状态。
- `src/core/shared/ids.ts`：三类 ID 改为数字。
- `src/core/game-state.ts`：删除 `DebutEntry/PendingEquipment/pendingDebuts`。
- `src/core/world/officer.ts`、`item.ts`：nullable 位置与必填登场条件。
- `src/core/world/debut.ts`、`fixture.ts`：登场模型迁移；具体剧本装配位于 `src/data/scenarios/index.ts`。
- `src/core/world/queries.ts` 及 core/store/UI 测试和调用点：nullable 守卫、数字 fixture 与数字排序。
- `AGENTS.md`、`CONTEXT.md`：替换旧拼音 ID、独立待登场池和待登场装备红线。

## 任务清单

- [x] 生成器产出共享目录/拓扑与四时期状态；首引用道具去重、数字身份和计数测试红绿。
- [x] 生成器显式校订四个已确认武将姓名，并以回归测试锁定规范输出。
- [x] `scenario` 合并共享/时期数据，四剧本状态与可选君主测试红绿。
- [x] 删除 `DebutEntry/pendingDebuts`，实体位置 nullable，登场与未来装备测试红绿。
- [x] 全仓迁移数字 ID 与数字升序，逐模块修复 nullable 守卫和回归测试。
- [x] 运行生成 `--check`、全测试、typecheck、lint、build并同步根文档。
- [x] 先以生成器/战斗地图测试锁定 38 城坐标、地图引用、七图尺寸/地形/城池格和无静默回退（RED）。
- [x] 迁移 terrain-only 输入快照，扩展生成器产出共享城市地图字段与七张规范化地形图（GREEN）。
- [x] 接入数字 `BattleMapId`、七图注册表与现有战斗流程，删除 `plains` 占位和回退并更新 fixture/回归测试。
- [x] 删除 `BattleMap.cityTiles/attackerSpawns/defenderSpawns` 冗余派生字段，接入原版八方向动态出生阵形并更新回归测试。
- [x] 运行生成 `--check`、全测试、typecheck、lint、format check、build并同步 `AGENTS.md` 红线。

## TDD：是

生成器/scenario/debut 先写或修改一个行为测试使其失败，再做最小实现；全仓 ID 类型迁移用 typecheck 作为编译反馈环，并保留关键排序行为测试。

## 风险 / 待定

- 数字 ID 升序会改变旧拼音序下的平局与 RNG 消费，但新模型内同 seed 仍确定；这是已接受行为。
- `Record<number,T>` 序列化键仍是字符串；运行时数字访问由 JS 属性键转换支持，不改成稀疏数组。
- 当前没有持久化存档，因此不做字符串 ID 存档迁移。
- 待定：暂无。

## 质量自检

- 接口最小：只新增一个值对象，删除两个待登场类型和一个根状态集合。
- 单一真相源：位置为空派生未登场；装备直接持有；共享资料只存一份。
- 低改动放大：新增时期只新增状态文件，城市/武将/道具基础资料集中维护。
- 无提前抽象：固定静态 JSON、无仓储/schema/migration 框架。
- 测试行为导向：锁身份、成员、去重、登场、引用和确定性，不锁脚本内部函数。
- 依赖健康：生成器离线；对局推进保持 `ui → store → core`，开局数据保持 `store → data/scenarios → core`，core 不反向依赖具体剧本。

# main-flow-ui 开发文档

## 方案概述

纯 UI 切片：**不动 core/store/feedback 规则**，只重建 `src/ui/`，并在 `src/store/selectors.ts` **新增只读再导出**（战斗查询/类型），把 UI 对 core 的依赖继续收在 `ui → store → core` 两段内。技术栈落到总纲约定的 **Tailwind v4 + shadcn/ui**（替换 `19` 的手写 `styles.css`），toast 迁到 **Sonner**（保留 `messages.ts` 的文案/可见性映射逻辑，只换渲染壳）。

关键取舍：

- **四段流程由 store 状态派生、不引入 UI 路由/全局状态机**。顶层 `App` 决策树：无 `game` → 选剧本/选君主向导；`game.activeBattle` → 战斗屏；否则 → 大地图屏。暂停态（`pendingSuccession`/`pendingDefense`）作为大地图屏之上的对话框，战果作为战斗屏之上的对话框。唯一的本地 UI 状态是「开局两步向导走到第几步」「当前选中的城/单位」「正在组合的命令/行动草稿」。
- **命令优先交互（PRD 故事 3）= 一个本地纯状态机 `CommandDraft`**，不做元数据驱动的通用向导引擎（YAGNI）。选中我方城 → 指令面板点一条命令 → 草稿按该命令**缺什么补什么**（执行人/目标城/目标将/道具/俘虏/数量/出征名单+粮草）逐步收集。把命令按「输入签名」归类（见下），草稿用判别式联合显式列举每类的待收集态，地图点击在「待选目标城」态下回填目标。
- **「选完即执行 + 命令粘住复用」**：当**最后一个待收集槽是离散选择**（选人/选物品/选俘虏/选目标将/选目标城）时，**点选即派发**、无独立确认步；派发成功后草稿**回到同一命令的选人步**（`onDraft(startCommand(command))`），可继续给下一个武将下同一条命令、连续批量执行（列表已自动剔除刚占用者）。**仅需输数字的终结槽**（征兵量/分配量/输送量/随军粮草/交易量）才显式「执行」按钮。「取消/返回」回到指令面板。
- **战斗交互 = 同构的本地纯状态机 `ActDraft`，地图为主、操作菜单浮动**：选我方单位 → 显示 `reachableTiles` → 点落点（或原地）后**浮动动作菜单锚定单位旁** → 选攻击/施法/休息 → 攻击点 `attackableTiles` 内敌格、施法选 `availableSkills` 再点 `skillTargetTiles` 内目标 → 组装 `{type:'battle',action:{type:'act',...}}` 派发。**无常驻侧栏**：属性收进顶栏〔选中〕可点弹出的详情 dialog（单位全属性 / 所点地形效果），最大化地图空间；地图**可拖动平移 + 缩放**。「结束当日」`endDay`、「撤退」`retreat` 置顶栏角落。顶栏另有「概览」入口 → 战况概览 dialog（双方全员列表 + 兵力 + 简化相对位置图；**敌方粮草恒显 `???`**，谍报揭示留后续 core 切片）。
- **战斗分胜负回写仍走既有 action**：UI 不算任何战斗规则，只在 `activeBattle.outcome` 非空时弹战果 dialog，点击或超时 `dispatch({type:'resumeMonth'})` 让 core 收尾并续跑月末（可能再次进入战斗/选君，屏幕自动重新派生）。
- **预览地图与经营大地图是两个独立组件、不共用**（关注点完全不同）：
  - **选君主预览 `ScenarioPreviewMap`**：极简只读 SVG，城池=正方形 `<rect>`、邻接=`<line>`，唯一目的=看清势力范围；由 `scenarioPreview(scenarioId)` 喂数据（不构造 `GameState`），选中君主辖城脉冲高亮；无点城事件、无操作。刻意简单、基本不会再改。
  - **经营大地图 `WorldMap`**：完整、需后期美化（底图/城池图标/精灵），承载选城点击与命令优先交互事件；本切片先用占位渲染，但接口/交互按「完整经营地图」设计，留足后期美化空间，与预览解耦各自演进。
- **所有美术处一律语义色块 + 文字标签**：势力色由 `factionColor(lordId, playerLordId)` 纯 UI 派生（HSL by id；空城灰；我方高亮）；兵种/地形/天气/状态/性格中文标签集中在 `ui/labels.ts`（UI 层，与 `messages.ts` 同属「中文只在 UI」）。
- **移动端强制横屏（不要求用户物理旋转）**：用 `ForceLandscape` 包裹层——横屏直接渲染；**竖屏时用 CSS `transform: rotate(90deg)` + 宽高互换把整个 app 旋转成横屏**呈现，指针/触控事件随 transform 一并旋转、坐标自洽（取代「请旋转」遮罩，因 `screen.orientation.lock()` 在 iOS Safari/普通网页不可用）。触控目标 ≥ 44px。大地图屏布局=顶栏 + 地图（左/中）+ **选中城操作面板（右侧固定列）**，信息与地图同屏不遮挡。

## 页面线框（占位示意，非最终视觉）

> 仅表达结构/分区/交互锚点，色块与图标后期美化；横屏优先。

### ① 开局向导 · 选剧本

```
┌──────────────────────────────────────────────────────────────┐
│  三国 · 新的征程                                  [取消(可选)]   │  标题条
│  ①选剧本 ───────── ②选君主                       (①高亮)       │  步骤指示
├──────────────────────────────────────────────────────────────┤
│   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                 │
│   │▓▓▓▓▓▓▓│ │▓▓▓▓▓▓▓│ │▓▓▓▓▓▓▓│ │▓▓▓▓▓▓▓│  ← 卡片=色块占位   │
│   │群雄割据│ │董卓乱政│ │三分天下│ │ ……   │     名 + 起始年    │
│   │189 年  │ │194 年  │ │208 年  │ │       │     选中=金边     │
│   └────────┘ └─[选中]─┘ └────────┘ └────────┘                 │
├──────────────────────────────────────────────────────────────┤
│                                            [ 下一步：选君主 ]   │  选中后可点
└──────────────────────────────────────────────────────────────┘
```

### ② 开局向导 · 选君主（左列表 + 右预览地图）

```
┌──────────────────────────────────────────────────────────────┐
│  董卓乱政 · 194 年                                   [取消]     │
│  ①选剧本 ───────── ②选君主                       (②高亮)       │
├───────────────┬──────────────────────────────────────────────┤
│  君主          │  ScenarioPreviewMap（极简只读 SVG）           │
│ ┌───────────┐ │   · · ·[▣]· · · · · · ·                       │
│ │■ 刘备  ×1 │ │   · ·[▣]· · ·[★]· · · ·   ★=选中君主城(脉冲)  │
│ │■ 曹操  ×5 │◀│   · · · ·[★]· ·[★]· · ·                       │
│ │■ 孙坚  ×2 │ │   ·[▣]· · · · · · · ·[▣]  ▣=各势力色 灰=空城  │
│ │■ 吕布  ×1 │ │   （邻接 <line>·城池 <rect>）                  │
│ └───────────┘ │                                              │
│ (选中=金边)    │                                              │
├───────────────┴──────────────────────────────────────────────┤
│  [ ← 返回选剧本 ]                            [ 开始游戏 ]      │
└──────────────────────────────────────────────────────────────┘
```

### ③ 经营大地图屏

```
┌───────────────────────────────────────────────────────┬──────────────┐
│ 公元194年3月·君主:刘备  [结束策略(月末)] [新游戏]       │ 选中城面板    │ 顶栏
├───────────────────────────────────────────────────────┤(右侧固定列)   │
│        经营大地图 WorldMap（势力色·邻接线·后期美化）     │〔小沛〕我方   │
│                                                        │ 状态/农商/金粮│
│      [▣]──[▣]    [★选中]                               │ 民忠/防灾/兵  │
│        │    ╲    ╱                                     │──────────────│
│      [▣]   [☆敌]──[灰空]                               │ 指令面板      │
│                                                        │内政|人事|军事|外交│
│   （目标城收集态：可选城脉冲高亮）                       │ 开垦 招商 出巡│
│                                                        │ 治理 搜寻 …   │
│                                                        │ (点一条进收集) │
├────────────────────────────────────────────────────────┴─────────────┤
│   toast 串行单条从顶部居中浮现（月末多条逐条出现）                       │
└───────────────────────────────────────────────────────────────────────┘
选执行人时面板切为「可用武将列表」(officersInCity onlyAvailable)；离散选择=选完即派发、命令粘住复用。
```

### ④ 战斗屏（地图最大化 · 浮动菜单 · 顶栏概览/详情）

```
┌───────────────────────────────────────────────────────────────┐
│ 第3天·雨·我粮1200 敌粮??? │〔选中:关羽〕点弹详情│[概览][结束当日][撤退]│ 薄顶栏
├───────────────────────────────────────────────────────────────┤
│        32×32 地形网格（最大化·可拖动·可缩放）                    │
│            ░░░[守①]░░                                          │
│            ░[关羽★]░     ┌──────┐ ← 移动后浮动菜单(锚定单位旁)   │
│            ▒可达▒▒       │ 攻击 │                              │
│                          │ 施法▸│→ 技能子菜单(可用技能/MP)      │
│             ✦可击✦       │ 休息 │   可达蓝/可击红/技能范围紫    │
│                          │ 取消 │                              │
│                          └──────┘                              │
└───────────────────────────────────────────────────────────────┘
 战果 dialog：「我军大胜 / 战败」→ 点击或超时 dispatch(resumeMonth)
```

### ④b 战斗概览 dialog（顶栏「概览」点开 · 左右分栏）

```
┌─ 战况概览 ────────────────────────────────────────┐
│ ┌[玩家方]│对手方┐         │  相对位置预览(简化网格)   │
│ │关羽 兵5000 正常│         │   · · ▓城▓ · ·          │
│ │张飞 兵3800 混乱│         │   · ●守 · · ·           │
│ │赵云 兵4200 正常│         │   ★攻 · · · ·           │
│ │ …             │         │  ●=对手方 ★=玩家方       │
│ │本方粮草 1200   │         │                         │
│ └───────────────┘         │  (切到对手方:粮草显 ???) │
└──────────────────────────────────────────────────┘
```

### ⑤ 暂停态 · 待选新君 / 待选守军（强制模态，叠在大地图屏上）

```
┌─ 请拥立新君 ─────────────────┐   ┌─ 敌军来犯 · 小沛 ──────────────┐
│ 君主 刘备 遭劫，择一继位：    │   │ 选择出战守军（最多10） 已选2/10│
│  诸葛亮 智99 〔太守〕        │   │ ☑关羽 兵5000〔太守〕          │
│  赵云   智78                │   │ ☑张飞 兵3800                  │
│  关羽   智75                │   │ ☐简雍 兵0                     │
│ (无取消，必选其一)           │   ├───────────────────────────────┤
└─────────────────────────────┘   │ [弃守(直接占城)]      [出战]   │
                                   │ (默认勾选推荐守军=太守领衔+兵力降序)│
                                   └───────────────────────────────┘
```

## 接口设计

### store/selectors.ts —— 新增只读再导出（UI↔core 唯一通道，向下依赖合法、零规则）

```ts
// 开局预览（建局前拿城池布局；data 层只读摘要，零规则、不构造 GameState）
export { scenarioPreview, type ScenarioPreview } from '../data/scenarios'
// 战斗查询（纯只读 selector，PRD 允许经 selectors 暴露）
export { reachableTiles, attackableTiles, skillTargetTiles } from '../core/military/battle-movement'
export {
  availableSkills,
  SKILL_DEFS,
  type SkillId,
  type SkillDef,
} from '../core/military/battle-skill'
export {
  terrainAt,
  isCityTile,
  GRID_SIZE,
  type Terrain,
  type BattleMap,
} from '../core/military/battle-map'
export { aliveUnits, unitAt, sideTroops, computeDamage } from '../core/military/battle-core'
export type {
  BattleState,
  BattleUnit,
  BattleAction,
  BattleSide,
  BattleMode,
  BattleOutcome,
} from '../core/military/battle'
export type { Weather } from '../core/military/battle-weather'
export type { BattleStatus } from '../core/military/battle-status'
export type { Adjacency } from '../core/world/adjacency'
// 其余（officersInCity / effectiveOfficer / governorOf / defendingOfficers / successionCandidates /
//  SCENARIOS / lordsForScenario / City / Officer / Action / … ）已在 19 导出，沿用。
```

### ui/faction-color.ts —— 势力色（纯 UI 派生）

```ts
/** 势力色：空城灰、我方高亮（金边语义另由调用方加 ring），其余按 lordId 派生稳定 HSL。 */
export function factionColor(lordId: OfficerId | null, playerLordId: OfficerId): string
/** 我方判定（调用方据此加高亮边框/底色）。 */
export function isPlayerFaction(lordId: OfficerId | null, playerLordId: OfficerId): boolean
```

### ui/labels.ts —— UI 中文标签（与 messages.ts 并列，core/store 仍零中文）

```ts
export const TROOP_LABEL: Record<TroopType, string>
export const STATUS_LABEL: Record<CityStatus, string> // 城市灾害状态
export const TERRAIN_LABEL: Record<Terrain, string>
export const WEATHER_LABEL: Record<Weather, string>
export const BATTLE_STATUS_LABEL: Record<BattleStatus, string> // 混乱/禁咒/定身/奇门/石阵/死亡/正常
export function personalityLabel(o: Officer): string // 君主表/武将表按 lordId===id 切换（沿用 19 app-shell）
```

### ui/world/command-draft.ts —— 命令优先草稿（本地纯状态机，零规则）

```ts
/** UI 提供的经营命令种类（= 我方城面板上的指令；与 EconomyAction['type'] 对应子集）。 */
export type CommandKind =
  | 'reclaim'
  | 'commerce'
  | 'patrol'
  | 'govern'
  | 'banquet'
  | 'search'
  | 'plunder' // 执行人-only
  | 'recruit'
  | 'allocate' // 执行人 + 数量
  | 'trade' // 执行人 + 买卖 + 数量
  | 'reward'
  | 'confiscate' // 执行人 + 道具
  | 'suborn'
  | 'behead'
  | 'banish' // 俘虏/在城处置
  | 'entice'
  | 'alienate'
  | 'instigate'
  | 'induce' // 执行人 + 敌方目标将
  | 'scout'
  | 'move'
  | 'transport' // 执行人 + 目标城
  | 'campaign' // 名单 + 目标城 + 粮草

/** 命令分组（仅 UI 面板归类展示）。 */
export type CommandGroup = 'develop' | 'personnel' | 'military' | 'diplomacy'
export const COMMAND_GROUPS: Record<CommandGroup, readonly CommandKind[]>

/**
 * 草稿态：选中城后逐步收集某命令的入参。判别式联合显式列举「正在收集什么」，
 * 不做通用 slot 引擎。`pending` 字段携已收集的参数。地图点城在 awaiting==='target-city' 时回填。
 */
export type CommandDraft =
  | { readonly kind: 'idle' }
  | { readonly kind: 'pick-command' } // 已选城、待选命令
  | {
      readonly kind: 'collect'
      readonly command: CommandKind
      readonly awaiting: DraftSlot
      readonly officerId?: OfficerId
      readonly targetCityId?: CityId
      readonly officerIds?: readonly OfficerId[]
    } // campaign 名单累积

/** 待收集的下一个参数槽。 */
export type DraftSlot =
  | 'executor'
  | 'amount'
  | 'trade-args'
  | 'item'
  | 'captive'
  | 'target-officer'
  | 'target-city'
  | 'campaign-members'
  | 'provisions'

/** 起手：某命令进入收集态（计算其第一个待收集槽）。 */
export function startCommand(command: CommandKind): CommandDraft
/** 推进：把一次输入（选将/选城/选将集/数值…）并入草稿，返回新草稿（仍缺则换下一槽，集齐则 awaiting 置终态）。 */
export function advanceDraft(draft: CommandDraft, input: DraftInput): CommandDraft
/** 草稿是否集齐、可转 Action。 */
export function draftToAction(draft: CommandDraft): Action | null
/** 当前草稿是否处于「等地图点目标城」态（驱动地图高亮可选城）。 */
export function isAwaitingTargetCity(draft: CommandDraft): boolean

export type DraftInput =
  | { readonly slot: 'executor'; readonly officerId: OfficerId }
  | { readonly slot: 'amount'; readonly amount: number }
  | { readonly slot: 'trade-args'; readonly mode: TradeMode; readonly amount: number }
  | { readonly slot: 'item'; readonly itemId: ItemId }
  | { readonly slot: 'captive'; readonly captiveId: OfficerId }
  | { readonly slot: 'target-officer'; readonly targetOfficerId: OfficerId }
  | { readonly slot: 'target-city'; readonly targetCityId: CityId }
  | { readonly slot: 'campaign-members'; readonly officerIds: readonly OfficerId[] }
  | { readonly slot: 'provisions'; readonly provisions: number }
```

> 合法性（能否对某将/某城下令）仍由 `canDispatch(action)` 判定——草稿只负责**形态收集**，集齐后按钮 disabled 走 `canDispatch`，绝不在 UI 里复刻规则。
>
> **选执行人列表只列可用武将** `officersInCity(game, cityId, { onlyAvailable: true })`（已天然排除占用/俘虏/非己方），不显示不可选者；剩余命令相关可行性（体力/上限等）仍可经 `canDispatch` 对该将置灰+`reason` 提示，失败也兜底 toast。俘虏类（招降/处斩）另取 `captivesInCity`、目标敌将另取目标城的敌方武将。

### ui/battle/act-draft.ts —— 战斗行动草稿（本地纯状态机）

```ts
export type ActDraft =
  | { readonly kind: 'idle' }
  | { readonly kind: 'unit'; readonly officerId: OfficerId; readonly moveTo?: Position } // 已选单位、可改落点
  | { readonly kind: 'attack'; readonly officerId: OfficerId; readonly moveTo?: Position } // 待点敌格
  | {
      readonly kind: 'cast'
      readonly officerId: OfficerId
      readonly moveTo?: Position
      readonly skillId: SkillId
    } // 待点目标
  | { readonly kind: 'cast-pick-skill'; readonly officerId: OfficerId; readonly moveTo?: Position } // 待选技能

/** 顶栏〔选中〕点击弹详情的对象：选中单位 或 所点地形格。 */
export type BattleInspect =
  | { readonly kind: 'unit'; readonly officerId: OfficerId }
  | { readonly kind: 'tile'; readonly pos: Position }

export function selectUnit(officerId: OfficerId): ActDraft
export function setMove(draft: ActDraft, moveTo: Position | undefined): ActDraft
/** 组装可派发的战斗 act；未集齐返回 null。rest 直接成型，attack/cast 需目标。 */
export function actToBattleAction(
  draft: ActDraft,
  target?: Position
): Extract<BattleAction, { type: 'act' }> | null
```

### ui 屏幕/组件签名

```ts
// src/App.tsx —— 顶层决策树（按 store 状态派生屏幕）
export function App(): JSX.Element

// src/ui/screens/new-game-screen.tsx —— 两步卡片向导（剧本卡 → 君主卡 → 开始）
export function NewGameScreen(props: {
  readonly onStarted: () => void
  readonly canCancel: boolean
  readonly onCancel: () => void
}): JSX.Element

// src/ui/screens/world-screen.tsx —— 顶部信息条 + 大地图 + 选中城操作面板 + 暂停对话框
export function WorldScreen(props: { readonly onNewGame: () => void }): JSX.Element

// src/ui/screens/scenario-preview-map.tsx —— 选君主预览：极简只读 SVG，城池 <rect> 正方形 + 邻接 <line>，选中君主辖城脉冲。
// 与经营大地图不共用；刻意简单、只为看清势力范围。
export function ScenarioPreviewMap(props: {
  readonly preview: ScenarioPreview // scenarioPreview(scenarioId) 的城+邻接
  readonly selectedLordId: OfficerId | null // 高亮基准：被选君主（辖城脉冲、该势力色突出）
}): JSX.Element

// src/ui/world/world-map.tsx —— 经营大地图：完整、需后期美化，承载选城点击事件。本切片占位渲染，接口按完整地图设计。
export function WorldMap(props: {
  readonly game: GameState // 城池/归属/邻接来源（live 局面）
  readonly selectedCityId: CityId | null
  readonly highlightCityIds?: readonly CityId[] // 脉冲：目标城收集态下的可选城
  readonly onSelectCity: (id: CityId) => void
}): JSX.Element

// src/ui/world/city-panel.tsx —— 横屏右侧固定列。我方城：信息 + 指令面板 + CommandDraft 分步收集；
// 敌/空城：只读可见信息，仅在某 target-city 草稿进行中时作为目标候选（统一命令优先、不另开「先选敌城」入口）。
export function CityPanel(props: {
  readonly cityId: CityId
  readonly draft: CommandDraft
  readonly onDraft: (d: CommandDraft) => void
}): JSX.Element

// src/ui/battle/battle-screen.tsx —— 全屏战斗编排：薄顶栏 + 最大化地图 + 浮动动作菜单 + 详情/战果 dialog。
// 本地 state: draft: ActDraft、inspect: {kind:'unit',officerId}|{kind:'tile',pos}|null（顶栏点击弹详情）。
export function BattleScreen(): JSX.Element

// src/ui/battle/battle-map.tsx —— 32×32 地形格 + 单位色块 + 高亮分层（选中金/可达蓝/可击红/可施紫，按 draft 阶段择一）。
// 自持视口（pan/zoom）；点格语义由 draft 态决定；提供单位屏幕坐标给浮动菜单锚定。
export function BattleMap(props: {
  readonly draft: ActDraft
  readonly onSelectUnit: (officerId: OfficerId) => void
  readonly onPickTile: (p: Position) => void // 选落点 / 攻击目标 / 技能目标（按 draft 阶段）
  readonly onInspectTile: (p: Position) => void // 点非交互格 → 顶栏可弹地形详情
  readonly anchorRef?: (officerId: OfficerId, screenPos: { x: number; y: number }) => void // 供菜单锚定
}): JSX.Element

// src/ui/battle/unit-action-menu.tsx —— 浮动动作菜单（锚定选中单位旁）：攻击/施法(▸技能子菜单)/休息/取消。
export function UnitActionMenu(props: {
  readonly draft: ActDraft // 仅 kind==='unit'/'cast-pick-skill' 时渲染
  readonly anchor: { x: number; y: number }
  readonly onChoose: (next: ActDraft) => void // 切到 attack/cast-pick-skill；rest 直接交 onAct
  readonly onAct: (action: Extract<BattleAction, { type: 'act' }>) => void
}): JSX.Element

// src/ui/battle/detail-dialog.tsx —— 顶栏〔选中〕点击弹出：单位全属性 或 地形（移动消耗/防御系数）。
export function DetailDialog(props: {
  readonly inspect: BattleInspect
  readonly onClose: () => void
}): JSX.Element

// src/ui/battle/battle-overview-dialog.tsx —— 顶栏「概览」点开：左右分栏。
// 左栏=顶部 [玩家方|对手方] tab 切换，下列当前一方全员(名/兵力/状态/主将) + 该方粮草（玩家=数值/对手='???'）。
// 右栏=双方相对位置简化图（始终两方都画）。本切片不实现谍报揭示（见风险）。
export function BattleOverviewDialog(props: { readonly onClose: () => void }): JSX.Element

// src/ui/battle/battle-result-dialog.tsx —— outcome 非空时弹战果；点击或超时 → dispatch({type:'resumeMonth'})。由 BattleScreen 自挂。
export function BattleResultDialog(props: { readonly outcome: BattleOutcome }): JSX.Element

// src/ui/pause-dialogs.tsx —— 强制模态总入口（按 store 暂停态择一）：
// · SuccessionDialog：候选 successionCandidates（显有效智力等），点选 → chooseSuccessor，无取消。
// · DefenseDialog：候选 defendingOfficers，**默认勾选推荐守军**（governorOf 领衔 + 兵力降序 ≤10，UI 编队便利、可增删），
//   出战 → chooseDefenders(ids)（置 activeBattle 防守战）/ 弃守 → chooseDefenders([])（直接占城）；不显示来犯预览。
export function PauseDialogs(): JSX.Element

// src/ui/feedback/toaster.tsx —— Sonner 宿主，**严格串行单条呈现**：订阅 store.feedback，一次只显队首一条。
// 队首项算 feedbackText（null 即时 store.dismiss(id) 跳过、不占显示），否则 toast(text, {duration: TTL,
// onClick/onAutoClose/onDismiss → store.dismiss(id)})；该条消失（超时或点击）后队首前移、自动出下一条。
// 月末多条事件由此逐条出现；点击可立即消失并跳下一条。
export function Toaster(): JSX.Element

// src/ui/layout/force-landscape.tsx —— 强制横屏包裹层：横屏直接渲染 children；
// 竖屏外层固定全屏、内层 rotate(90deg) + 宽高互换（≈100vh×100vw、transform-origin 居中平移），
// 把 app 旋转成横屏；指针/触控事件随 transform 旋转、坐标自洽。取代「请旋转」遮罩。
export function ForceLandscape(props: { readonly children: React.ReactNode }): JSX.Element
```

## 模块职责

- `store/selectors.ts`：唯一 UI↔core 通道，新增战斗只读查询/类型再导出；零逻辑。
- `ui/faction-color.ts`：势力色派生（纯 UI）。`ui/labels.ts`：UI 中文标签集中地（与 `messages.ts` 同属「中文只在 UI」）。
- `ui/world/command-draft.ts`：命令优先收集的纯状态机（形态收集，不含规则）。`ui/battle/act-draft.ts`：战斗行动收集的纯状态机。
- `ui/screens/*`：三块屏（开局向导/大地图/战斗）的编排与本地状态持有（选中城、选中单位、草稿）。
- `ui/world/*`、`ui/battle/*`：纯展示 + 把点击翻成草稿推进/`dispatch`。
- `ui/pause-dialogs.tsx`：两种暂停态选择面板。`ui/feedback/toaster.tsx`：反馈渲染壳（消费 store 队列）。
- `ui/components/ui/*`：shadcn 基础组件（按需 Button/Card/Dialog/Input/Badge）。
- 依赖方向：`screens → {world,battle,pause,feedback,components} → store/selectors`；`*-draft.ts` 不依赖 React、可纯函数单测。

## 要测的行为

UI 不强制测试（总纲）。仅对两个纯草稿状态机做轻量单测（可选、无 DOM），其余靠 `typecheck`/`build`/既有 566 测试不回归 + 手动跑通验收。

- [ ] `command-draft`：执行人-only 命令选将即集齐成 Action；`campaign` 收集名单+目标城+粮草后成 Action；`scout/move/transport` 在 `awaiting==='target-city'` 时 `isAwaitingTargetCity` 为真。
- [ ] `act-draft`：选单位→设落点→rest 成型；attack/cast 需目标方成型；`actToBattleAction` 未集齐返回 null。
- [ ] `factionColor`：空城返回灰、同 lordId 稳定同色、我方 `isPlayerFaction` 为真。

## 新建文件

- `src/ui/faction-color.ts`：势力色派生。
- `src/ui/labels.ts`：UI 中文标签。
- `src/ui/world/command-draft.ts`：命令草稿状态机（+ 可选同名 `.test.ts`）。
- `src/ui/screens/scenario-preview-map.tsx`：选君主极简只读预览地图（SVG 正方形）。
- `src/ui/world/world-map.tsx`：经营大地图（完整、后期美化、承载选城事件）。
- `src/ui/world/city-panel.tsx`：城信息 + 指令面板 + 草稿收集。
- `src/ui/battle/act-draft.ts`：战斗行动草稿（+ 可选 `.test.ts`）。
- `src/ui/battle/battle-screen.tsx`、`src/ui/battle/battle-map.tsx`：战斗屏（薄顶栏 + 最大化地图编排）与可拖动/缩放地图。
- `src/ui/battle/unit-action-menu.tsx`：浮动动作菜单（攻击/施法▸技能/休息/取消）。
- `src/ui/battle/detail-dialog.tsx`：顶栏点击弹出的单位/地形详情。
- `src/ui/battle/battle-overview-dialog.tsx`：战况概览（双方全员 + 兵力 + 简化位置图；敌粮 `???`）。
- `src/ui/battle/battle-result-dialog.tsx`：战果 dialog（点击/超时派发 resumeMonth）。
- `src/ui/screens/new-game-screen.tsx`、`src/ui/screens/world-screen.tsx`：开局向导、大地图屏。
- `src/ui/feedback/toaster.tsx`：Sonner 宿主。
- `src/ui/layout/force-landscape.tsx`：强制横屏包裹层（竖屏旋转 90° 渲染）。
- `src/ui/components/ui/*`、`src/lib/utils.ts`、`components.json`：shadcn 脚手架产物（CLI 生成）。
- `src/index.css`（或 `src/ui/tailwind.css`）：Tailwind v4 入口 + shadcn 主题变量。

## 修改文件

- `src/store/selectors.ts`：新增战斗只读再导出 + `scenarioPreview`（见上）。
- `src/data/scenarios/index.ts`：新增 `scenarioPreview(scenarioId)` 只读摘要（城 id/name/x/y/lordId + 共享 adjacency），零规则、不构造 GameState。
- `src/App.tsx`：改为「按 store 状态派生屏幕」的决策树——`ForceLandscape` 包裹当前屏（向导/大地图/战斗）+ 全局 `Toaster`；暂停态/战果 dialog 由对应屏自带（`WorldScreen` 挂 `PauseDialogs`、`BattleScreen` 挂 `BattleResultDialog`），保持组合根职责单一。
- `src/main.tsx`：导入 Tailwind 入口 css（替代 `styles.css`）。
- `vite.config.ts`：加 `@tailwindcss/vite` 插件 + `resolve.alias` 的 `@ → /src`。
- `tsconfig.app.json`：加 `paths` 的 `@/*`（shadcn 需要）。
- `package.json`：新增 `tailwindcss`、`@tailwindcss/vite`、`sonner`、shadcn 依赖（`class-variance-authority`/`clsx`/`tailwind-merge`/`lucide-react`/按需 `@radix-ui/*`），均用包管理器装最新。

## 删除文件

- `src/ui/app-shell.tsx`、`src/ui/new-game.tsx`、`src/ui/feedback/toast.tsx`、`src/ui/styles.css`——被新结构替换。`src/ui/feedback/messages.ts` **保留不动**。
- ~~`src/vite-env.d.ts`~~ **保留**（实施期修正）：`vite/client` 提供 `*.css` 环境模块声明，删后 css 副作用 import 在 `tsc` 下 `TS2882` 失败。

## 任务清单

- [x] 装 Tailwind v4 + `@tailwindcss/vite`，配 `@/` 别名（vite + tsconfig），shadcn 风格基础组件（手写 new-york 风格 Button/Card/Dialog/Tabs/Checkbox/Input/Badge + `lib/utils.ts`，避开交互式 CLI），跑通 `build`；建 Tailwind 入口 css + 主题变量。（注：项目用 **pnpm**，非 npm——npm arborist 在 pnpm 布局上崩溃；并补装 `@types/node` 供 vite 配置类型。）
- [x] `selectors.ts` 加战斗只读再导出（含 `Position`/`TradeMode`）；`faction-color.ts` + `labels.ts`。
- [x] `ForceLandscape`（竖屏旋转 90° 强制横屏）+ `App` 决策树（无 game→向导、battle→战斗屏、否则→大地图屏）+ `Toaster`（Sonner，**串行单条**：队首逐条显示、默认时长或点击消失后出下一条；复用 `feedbackText`/可见性过滤）。
- [x] `scenarioPreview` 只读访问器 + selectors 再导出；`scenario-preview-map`：极简只读 SVG（正方形城池 + 邻接线 + 选中君主辖城脉冲）。
- [x] `new-game-screen`：①剧本卡片页 →②选君主页（左列表 + 右 `ScenarioPreviewMap`）→ `newGame(request)` 开始。
- [x] 经营 `world-map`：从 `game` 渲染 `adjacency` 连线 + 城池节点（势力色、我方高亮、空城灰、选中描边、`highlightCityIds` 脉冲）+ 选城事件；占位渲染、接口按完整地图设计。
- [x] `command-draft` 状态机（+ 单测）+ `city-panel`：我方城命令优先收集（执行人/数量/道具/俘虏/目标将/交易/输送三数）；按钮置灰走 `canDispatch`；离散终结选完即派发 + 命令粘住复用。
- [x] 目标城类（`scout`/`move`/`transport`/`campaign`）：草稿进入「待选目标城」→ 地图高亮邻接可选城 → 回填 → 名单/粮草 → 派发；敌/空城只读面板。
- [x] 月末按钮 `endMonth` + 多条结算事件逐条 toast。
- [x] `pause-dialogs`：选新君（`successionCandidates` → `chooseSuccessor`）+ 选守军（`defendingOfficers` 候选，**默认勾选推荐守军**=`governorOf` 领衔 + 兵力降序 ≤10、可增删；出战 `chooseDefenders(ids)` / 弃守 `chooseDefenders([])`）。
- [x] `act-draft`（+ 单测）+ `battle-screen`/`battle-map`（可拖动/缩放、最大化）+ `unit-action-menu`（浮动）+ `detail-dialog`（顶栏点击）+ `battle-overview-dialog`（双方全员/兵力/位置图、敌粮 `???`）：选将→移动→浮动菜单选攻击/施法/休息→结束当日逐日推进；高亮分层（可达/可击/技能范围）+ 可用技能子菜单。
- [x] `battle-result-dialog`：`activeBattle.outcome` 非空弹战果，点击或超时 `dispatch(resumeMonth)`。
- [x] 收尾：删除被替换的旧文件（`app-shell`/`new-game`/`feedback/toast`/`styles.css`）；`typecheck`/`lint`（仅 shadcn fast-refresh warning）/`build` 全绿、既有测试不回归（601 passed）。
  - **偏差**：`src/vite-env.d.ts` **保留不删**——它经 `vite/client` 提供 `*.css` 环境模块声明，删后 `import './index.css'`（`noUncheckedSideEffectImports`）会 `TS2882` 失败。dev.md 原「删除文件」一项就此修正。

## TDD：否（UI 切片）

总纲：UI 不强制测试。仅两个纯草稿状态机 + 势力色可选轻量单测。core/store 规则与既有 566 测试不得回归。

## 风险 / 待定

- **命令优先 vs 既有规则的边界**：草稿只收集形态，所有「能不能下」一律走 `canDispatch(action)` 置灰/提示，**严禁**在 `command-draft`/UI 里复刻 core 规则（红线）。campaign 的「相邻敌/空城」高亮可读 `game.adjacency` + `city.lordId` 做**展示性**筛选，真正合法性仍由 `canCampaign`/`canDispatch` 决定。
- **32×32 在小横屏偏小**：暂定「缩放铺满屏高 + 可平移」（PRD 待定项）；开发期按真机决定是否加缩放/小地图，属纯 UI 调参、不影响接口。
- **邻接连线密集处拥挤**：暂定全画（PRD 待定项），视效果决定是否仅画选中城的邻接；`WorldMap` 已留 `highlightCityIds`，切换成本低。
- **敌/空城信息可见性**：core 无城池战争迷雾，本切片敌/空城只读面板展示已知量（名称 + 势力色 + 太守等公开派生），不做迷雾；侦察结果仍以 toast 呈现（沿用既有事件），不另建侦察详情态。
- **Sonner 与 store 队列衔接（串行单条）**：`Toaster` 把 `store.feedback` 当**严格队列**，一次只 `toast()` 队首一条——队首 `feedbackText` 为 null（非玩家相关事件）即时 `store.dismiss(id)` 跳过；否则带默认时长 `TTL`（常量，约 3.5s）显示，`onClick`/`onAutoClose`/`onDismiss` 均回调 `store.dismiss(id)`，队首移除后 effect 自动推下一条。如此月末多条事件**逐条出现**、点击可立即跳下一条；`newGame` 的 `clearFeedback` 仍清空队列。`issued` 确认项与 `event`/`failure` 共用同一串行通道。
- **敌方粮草揭示（谍报）本切片不做**：`core` 战斗 action 不产事件、谍报「仅判成功、不改状态」（13-battle-skills 红线），UI 无从得知是否命中，故敌粮在概览里恒显 `???`。真正的「谍报成功→揭示」需后续给 battle 增一条只读反馈信号（command-feedback 延伸，属 core 改动），单独切片处理，不在本纯 UI 切片内。
- **强制横屏取代「旋转提示」（覆盖 PRD 验收项）**：PRD 原验收「竖屏显示旋转提示遮罩」改为 `ForceLandscape` 竖屏旋转 90° 强制横屏渲染（用户无需物理旋转）。`screen.orientation.lock()` 在 iOS Safari/普通网页不可用，故走 CSS transform。注意点：旋转坐标系内 `WorldMap`/`BattleMap` 的拖动/缩放手势需用「相对该元素」的指针坐标（transform 已自动换算，无需手动反算），`position:fixed`/`100vh` 在旋转层内按交换后的宽高设值；开发期真机校验触控方向与滚动。`CONTEXT.md` 的术语「旋转提示遮罩」相应失效，落地为强制横屏（纯 UI、不影响 core/store）。
- **术语已就绪**：`Main Flow UI`/`World Map View`/`Battle Map View`/`Faction Color`/`Rotate Hint` 已在 `CONTEXT.md`（写 PRD 时种入），本切片为纯 UI、无新跨功能不变量，**无需升级** `CONSTITUTION`/`AGENTS` 红线（依赖方向 `ui→store→core`、中文只在 UI、selectors 唯一通道均为既有红线，本切片沿用）。

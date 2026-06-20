# store-ui PRD

## 问题

`core` 已完整实现（01–18：经营/战斗/AI/命令反馈），但 `src/store`、`src/ui` 仍为空（只有占位 `App.tsx`）。规则引擎跑不起来——玩家无法下令、看不到任何反馈。需要首次接入上层：让 `core` 真正可玩。

## 目标

接通 `ui → store → core`，让玩家能在界面上对武将下令、推进月份，并以 toast 看到命令成功/失败/月末结算的中文反馈。**本切片重心是 store 层**（完整、可独立测试、可复用）；UI 只需可用，后期可整体替换。

## 关键行为 / 用户故事

1. 作为玩家，我要在 store 持有的当前对局上下令（派发任意经营/外交指令 Action），以便推进游戏。
2. 作为玩家，下令失败时我要看到一条中文 toast 说明原因（如"无足够金钱""该将体力不足"），以便知道为何不可。
3. 作为玩家，下令成功且有结果数据时（开垦增量、搜寻收获、掠夺所得等）我要看到对应中文 toast。
4. 作为玩家，我要点"月末/结束策略"推进一个月，并看到月末结算产生的多条中文 toast（搜寻/掠夺/外交结果、灾害、重选君主等系统事件）。
5. 作为玩家，UI 应在派发前据 `canApply` 预判，把不可下的指令置灰并给出原因提示。
6. 作为玩家，当月末进入暂停态（战斗 / 待选新君 / 待选守军）时，store 要如实暴露该态，UI 至少能让我经对应 action 把流程推下去（不卡死）。

## 范围 & 不做

- 做：
  - **store 层（完整）**：单一 Zustand store，持有当前 `GameState`，封装 `dispatch(action)`（走 `applyWithEvents`）、`canDispatch(action)`（走 `canApply`，供置灰）、`newGame(seed)`。
  - **瞬态反馈队列**：store 在自身状态（**非 `GameState`**）维护一个结构化通知队列——每次 `dispatch` 把成功的 `events` 与失败的 `reason` 推入；提供消费/出队接口。队列里只放 `core` 的结构化 `OutcomeEvent`/`ReasonCode`，**零中文、不写规则、不挑台词**。
  - **暂停态全量暴露**：store 透传 `activeBattle`/`pendingSuccession`/`pendingDefense`，并能派发全部对应 action（`battle`/`resumeMonth`/`chooseSuccessor`/`chooseDefenders`）。
  - **UI 文案映射模块（UI 层）**：把 `OutcomeEvent`/`ReasonCode` → 中文文案，多变体台词在此随机挑选，对照 `docs/business-command-rules.md`。
  - **可用经营闭环 UI**：城/武将列表与基础属性展示、即时类指令面板（开垦/招商/出巡/治理/征兵/赏赐/没收/分配等）+"结束策略/月末"按钮 + toast 渲染。
- 不做：
  - 完整交互式战棋界面、地图视图、精致美术——交互式战斗 UI 留**后续切片**；本切片暂停态 UI 只做最小占位（如待选新君给个选人弹窗、待选守军给最简列表/可弃守）。
  - 存档/读档（localStorage 持久化）——留后续切片；本切片刷新即丢、`newGame` 重置。
  - 多 AI 势力、动画/音效等（沿用总纲 MVP 边界）。
  - 任何游戏规则写进 store/ui（红线）。

## 验收标准

- [ ] 存在一个 Zustand store，初始即持有一个由 fixture 生成的 `GameState`；`newGame(seed)` 可重置。
- [ ] `dispatch(action)` 经 `applyWithEvents` 推进状态：成功则更新 `GameState` 并把 `events` 入通知队列；失败则状态不变并把 `reason` 入通知队列。
- [ ] store 暴露 `canDispatch(action)`（=`canApply` 结果），UI 据此置灰按钮并预判 `reason`。
- [ ] store 状态里的通知队列只含结构化 `events`/`reason`（零中文），UI 订阅并经映射模块翻成中文 toast；toast 消费后能出队。
- [ ] 月末（`endMonth`）一次产生的多条事件全部入队、全部能渲染为 toast。
- [ ] UI 能完成一轮经营闭环：选城 → 对在任武将下若干即时指令 → 点月末 → 看到结算 toast → 进入下一月。
- [ ] 进入任一暂停态时 store 如实反映，UI 经对应 action 能把流程推进、不卡死。
- [ ] store/ui 不含任何游戏规则与中文运行时串以外的文案逻辑（中文只在 UI 映射模块）。

## 待定决策

暂无。

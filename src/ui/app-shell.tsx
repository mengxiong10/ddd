import { useState } from 'react'
import { useGameStore } from '../store/game-store'
import type { Action, City, Officer, Personality, TroopType, CityStatus } from '../store/selectors'
import {
  playerCities,
  officersInCity,
  captivesInCity,
  itemsInCity,
  itemsOfOfficer,
  effectiveOfficer,
  effectiveTroopType,
  officerLoyalty,
  governorOf,
  troopCapacity,
  isBusy,
  isCaptive,
} from '../store/selectors'
import { reasonText } from './feedback/messages'

const TROOP_LABEL: Record<TroopType, string> = {
  cavalry: '骑兵',
  infantry: '步兵',
  archer: '弓兵',
  navy: '水军',
  elite: '极兵',
  mystic: '玄兵',
}
const STATUS_LABEL: Record<CityStatus, string> = {
  normal: '正常',
  famine: '饥荒',
  drought: '旱灾',
  flood: '水灾',
  riot: '暴动',
}
const LORD_PERSONALITY = ['和平', '大义', '奸诈', '狂人', '冒进']
const OFFICER_PERSONALITY = ['忠义', '大志', '贪财', '怕死', '卤莽']
const personalityLabel = (o: Officer): string =>
  (o.lordId === o.id ? LORD_PERSONALITY : OFFICER_PERSONALITY)[o.personality as Personality]!

/** 指令按钮：据 canDispatch 置灰，失败原因作 title 提示。 */
function Cmd({ action, label }: { action: Action; label: string }) {
  const canDispatch = useGameStore((s) => s.canDispatch)
  const dispatch = useGameStore((s) => s.dispatch)
  const check = canDispatch(action)
  return (
    <button
      className="cmd"
      disabled={!check.ok}
      title={check.reason ? reasonText(check.reason) : ''}
      onClick={() => dispatch(action)}
    >
      {label}
    </button>
  )
}

/** 数值指令（征兵/分配/交易）：本地输入 + 派发。 */
function NumberCmd({
  label,
  build,
  defaultValue,
}: {
  label: string
  build: (n: number) => Action
  defaultValue: number
}) {
  const [n, setN] = useState(defaultValue)
  const canDispatch = useGameStore((s) => s.canDispatch)
  const dispatch = useGameStore((s) => s.dispatch)
  const action = build(n)
  const check = canDispatch(action)
  return (
    <div className="numcmd">
      <span>{label}</span>
      <input type="number" value={n} onChange={(e) => setN(Number(e.target.value))} min={0} />
      <button
        className="cmd"
        disabled={!check.ok}
        title={check.reason ? reasonText(check.reason) : ''}
        onClick={() => dispatch(action)}
      >
        执行
      </button>
    </div>
  )
}

function CityList({
  cities,
  selected,
  onSelect,
}: {
  cities: City[]
  selected: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="panel city-list">
      <h3>我方城池</h3>
      {cities.map((c) => (
        <button
          key={c.id}
          className={`city-item ${c.id === selected ? 'active' : ''}`}
          onClick={() => onSelect(c.id)}
        >
          {c.name}（{STATUS_LABEL[c.status]}）
        </button>
      ))}
    </div>
  )
}

function CityInfo({ city }: { city: City }) {
  const game = useGameStore((s) => s.game)
  const gov = governorOf(game, city.id)
  return (
    <div className="panel city-info">
      <h3>{city.name}</h3>
      <div className="grid">
        <span>状态：{STATUS_LABEL[city.status]}</span>
        <span>太守：{gov ? gov.name : '无'}</span>
        <span>
          农业：{city.agriculture}/{city.agricultureCap}
        </span>
        <span>
          商业：{city.commerce}/{city.commerceCap}
        </span>
        <span>民忠：{city.loyalty}</span>
        <span>防灾：{city.disasterPrevention}</span>
        <span>人口：{city.population}</span>
        <span>金钱：{city.gold}</span>
        <span>粮食：{city.food}</span>
        <span>后备兵：{city.reserveTroops}</span>
      </div>
    </div>
  )
}

function OfficerList({
  cityId,
  selected,
  onSelect,
}: {
  cityId: string
  selected: string | null
  onSelect: (id: string) => void
}) {
  const game = useGameStore((s) => s.game)
  const all = officersInCity(game, cityId)
  return (
    <div className="panel officer-list">
      <h3>武将</h3>
      {all.map((o) => {
        const captive = isCaptive(game, o.id)
        const busy = isBusy(game, o.id)
        const wandering = o.lordId === null
        const tag = captive
          ? '俘虏'
          : wandering
            ? '在野'
            : o.lordId === o.id
              ? '君主'
              : busy
                ? '占用'
                : '在任'
        return (
          <button
            key={o.id}
            className={`officer-item ${o.id === selected ? 'active' : ''} tag-${tag}`}
            onClick={() => onSelect(o.id)}
          >
            {o.name}（{tag}）
          </button>
        )
      })}
    </div>
  )
}

function OfficerDetail({ officer }: { officer: Officer }) {
  const game = useGameStore((s) => s.game)
  const eff = effectiveOfficer(game, officer.id)
  const items = itemsOfOfficer(game, officer.id)
  return (
    <div className="officer-detail">
      <strong>{officer.name}</strong>
      <span>等级 {officer.level}</span>
      <span>武力 {eff.force}</span>
      <span>智力 {eff.intelligence}</span>
      <span>忠诚 {officerLoyalty(game, officer.id)}</span>
      <span>体力 {officer.stamina}</span>
      <span>
        兵力 {officer.troops}/{troopCapacity(eff)}
      </span>
      <span>兵种 {TROOP_LABEL[effectiveTroopType(game, officer.id)]}</span>
      <span>性格 {personalityLabel(officer)}</span>
      <span>道具 {items.length ? items.map((i) => i.name).join('、') : '无'}</span>
    </div>
  )
}

/** 选中武将的指令面板：即时类 / 数值类 / 道具类 / 处置类。 */
function CommandPanel({ officer, city }: { officer: Officer; city: City }) {
  const game = useGameStore((s) => s.game)
  const cityItems = itemsInCity(game, city.id).filter((i) => i.discovered)
  const heldItems = itemsOfOfficer(game, officer.id)
  const captives = captivesInCity(game, city.id)
  const oid = officer.id

  return (
    <div className="panel command-panel">
      <h3>指令 · {officer.name}</h3>
      <div className="cmd-row">
        <Cmd action={{ type: 'reclaim', officerId: oid }} label="开垦" />
        <Cmd action={{ type: 'commerce', officerId: oid }} label="招商" />
        <Cmd action={{ type: 'patrol', officerId: oid }} label="出巡" />
        <Cmd action={{ type: 'govern', officerId: oid }} label="治理" />
        <Cmd action={{ type: 'banquet', officerId: oid }} label="宴请" />
        <Cmd action={{ type: 'banish', officerId: oid }} label="流放" />
      </div>
      <div className="cmd-row">
        <NumberCmd
          label="征兵"
          defaultValue={100}
          build={(n) => ({ type: 'recruit', officerId: oid, amount: n })}
        />
        <NumberCmd
          label="分配(目标兵力)"
          defaultValue={officer.troops}
          build={(n) => ({ type: 'allocate', officerId: oid, amount: n })}
        />
      </div>
      <div className="cmd-row">
        <NumberCmd
          label="买入粮"
          defaultValue={10}
          build={(n) => ({ type: 'trade', officerId: oid, mode: 'buy', amount: n })}
        />
        <NumberCmd
          label="卖出粮"
          defaultValue={10}
          build={(n) => ({ type: 'trade', officerId: oid, mode: 'sell', amount: n })}
        />
      </div>
      <div className="cmd-row">
        <span className="cmd-label">赏赐（城中道具 → 本将）：</span>
        {cityItems.length === 0 && <em>城中无道具</em>}
        {cityItems.map((i) => (
          <Cmd
            key={i.id}
            action={{ type: 'reward', officerId: oid, itemId: i.id }}
            label={`赏「${i.name}」`}
          />
        ))}
      </div>
      <div className="cmd-row">
        <span className="cmd-label">没收（本将道具 → 城）：</span>
        {heldItems.length === 0 && <em>该将无道具</em>}
        {heldItems.map((i) => (
          <Cmd
            key={i.id}
            action={{ type: 'confiscate', officerId: oid, itemId: i.id }}
            label={`收「${i.name}」`}
          />
        ))}
      </div>
      <div className="cmd-row">
        <span className="cmd-label">招降 / 处斩（城中俘虏）：</span>
        {captives.length === 0 && <em>城中无俘虏</em>}
        {captives.map((cap) => (
          <span key={cap.id} className="captive-cmds">
            <Cmd
              action={{ type: 'suborn', officerId: oid, captiveId: cap.id }}
              label={`招降 ${cap.name}`}
            />
            <Cmd action={{ type: 'behead', captiveId: cap.id }} label={`处斩 ${cap.name}`} />
          </span>
        ))}
      </div>
    </div>
  )
}

export function GameScreen() {
  const game = useGameStore((s) => s.game)
  const dispatch = useGameStore((s) => s.dispatch)
  const newGame = useGameStore((s) => s.newGame)
  const cities = playerCities(game)

  const [cityId, setCityId] = useState<string>(() => cities[0]?.id ?? '')
  const [officerId, setOfficerId] = useState<string | null>(null)

  const city = game.cities[cityId] ?? cities[0]
  const officer = officerId ? game.officers[officerId] : undefined
  const lord = game.officers[game.playerLordId]

  return (
    <div className="game-screen">
      <header className="topbar">
        <span className="era">
          公元 {game.year} 年 {game.month} 月
        </span>
        <span>君主：{lord?.name}</span>
        <button className="endmonth" onClick={() => dispatch({ type: 'endMonth' })}>
          结束策略（月末）
        </button>
        <button className="newgame" onClick={() => newGame(Date.now() >>> 0)}>
          新游戏
        </button>
      </header>
      <div className="layout">
        <CityList
          cities={cities}
          selected={city?.id ?? ''}
          onSelect={(id) => {
            setCityId(id)
            setOfficerId(null)
          }}
        />
        <div className="center">
          {city && <CityInfo city={city} />}
          {city && <OfficerList cityId={city.id} selected={officerId} onSelect={setOfficerId} />}
        </div>
        <div className="right">
          {officer && <OfficerDetail officer={officer} />}
          {officer &&
            city &&
            officer.lordId === game.playerLordId &&
            officer.cityId === city.id && <CommandPanel officer={officer} city={city} />}
        </div>
      </div>
    </div>
  )
}

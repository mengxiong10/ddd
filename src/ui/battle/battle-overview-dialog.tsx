import { useCurrentGame } from '../../store/game-store'
import { aliveUnits, GRID_SIZE, type BattleSide } from '../../store/selectors'
import { BATTLE_STATUS_LABEL } from '../labels'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'

/**
 * 战况概览（`21-main-flow-ui`）：左右分栏。左=顶部 [玩家方|对手方] tab 切换 + 该方全员（名/兵力/状态/主将）
 * + 该方粮草（玩家=数值；对手=谍报当日揭示则数值、否则 '???'）。右=双方相对位置简化图（始终两方都画）。
 */
export function BattleOverviewDialog({ onClose }: { readonly onClose: () => void }) {
  const game = useCurrentGame()
  const battle = game.activeBattle
  if (!battle) return null
  const units = aliveUnits(battle)
  const commanderIds = new Set([battle.attackerCommanderId, battle.defenderCommanderId])

  const sideList = (side: BattleSide) => (
    <div className="flex flex-col gap-1">
      {units
        .filter((u) => u.side === side)
        .map((u) => (
          <div key={u.officerId} className="flex justify-between text-sm">
            <span>
              {game.officers[u.officerId]?.name ?? u.officerId}
              {commanderIds.has(u.officerId) ? ' 〔主将〕' : ''}
            </span>
            <span className="text-muted-foreground">
              兵{u.troops} · {BATTLE_STATUS_LABEL[u.status]}
            </span>
          </div>
        ))}
      <div className="mt-1 border-t pt-1 text-sm font-medium">
        本方粮草{' '}
        {side === 'player'
          ? battle.playerProvisions
          : battle.intelRevealDay === battle.day
            ? battle.opponentProvisions
            : '???'}
      </div>
    </div>
  )

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(94vw,40rem)]">
        <DialogHeader>
          <DialogTitle>战况概览 · 第 {battle.day} 天</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-[1fr_14rem] gap-4">
          <Tabs defaultValue="player">
            <TabsList>
              <TabsTrigger value="player">玩家方</TabsTrigger>
              <TabsTrigger value="opponent">对手方</TabsTrigger>
            </TabsList>
            <TabsContent value="player">{sideList('player')}</TabsContent>
            <TabsContent value="opponent">{sideList('opponent')}</TabsContent>
          </Tabs>
          <div className="rounded border bg-secondary/30 p-1">
            <svg viewBox={`0 0 ${GRID_SIZE} ${GRID_SIZE}`} className="h-full w-full">
              <rect x={0} y={0} width={GRID_SIZE} height={GRID_SIZE} fill="hsl(0 0% 100% / 0.4)" />
              {units.map((u) => (
                <circle
                  key={u.officerId}
                  cx={u.pos.x + 0.5}
                  cy={u.pos.y + 0.5}
                  r={0.9}
                  fill={u.side === 'player' ? 'hsl(210 90% 50%)' : 'hsl(0 75% 50%)'}
                />
              ))}
            </svg>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

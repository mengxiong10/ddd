import { useCurrentGame } from '../../store/game-store'
import { effectiveOfficer, effectiveTroopType, terrainAt } from '../../store/selectors'
import { TROOP_LABEL, BATTLE_STATUS_LABEL, TERRAIN_LABEL } from '../labels'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog'
import type { BattleInspect } from './act-draft'

/** 顶栏〔选中〕点击弹出：单位全属性 或 所点地形格信息。 */
export function DetailDialog({
  inspect,
  onClose,
}: {
  readonly inspect: BattleInspect
  readonly onClose: () => void
}) {
  const game = useCurrentGame()
  const battle = game.activeBattle
  if (!battle) return null

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(92vw,22rem)]">
        {inspect.kind === 'unit'
          ? (() => {
              const u = battle.units[inspect.officerId]
              const o = game.officers[inspect.officerId]
              if (!u || !o) return <p>单位不存在。</p>
              const eff = effectiveOfficer(game, inspect.officerId)
              return (
                <>
                  <DialogHeader>
                    <DialogTitle>
                      {o.name}（{u.side === 'player' ? '我方' : '对手方'}）
                    </DialogTitle>
                  </DialogHeader>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <span>等级 {u.level}</span>
                    <span>兵力 {u.troops}</span>
                    <span>武力 {eff.force}</span>
                    <span>智力 {eff.intelligence}</span>
                    <span>
                      技力 {u.mp}/{u.maxMp}
                    </span>
                    <span>兵种 {TROOP_LABEL[effectiveTroopType(game, inspect.officerId)]}</span>
                    <span>状态 {BATTLE_STATUS_LABEL[u.status]}</span>
                  </div>
                </>
              )
            })()
          : (() => {
              const map = game.battleMaps[battle.mapId]!
              const t = terrainAt(map, inspect.pos)
              return (
                <>
                  <DialogHeader>
                    <DialogTitle>地形 · {TERRAIN_LABEL[t]}</DialogTitle>
                  </DialogHeader>
                  <p className="text-sm text-muted-foreground">
                    坐标 ({inspect.pos.x}, {inspect.pos.y})
                  </p>
                </>
              )
            })()}
      </DialogContent>
    </Dialog>
  )
}

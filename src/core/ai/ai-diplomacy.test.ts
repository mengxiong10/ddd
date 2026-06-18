import { describe, it, expect } from 'vitest'
import { createInitialState } from '../world/fixture'
import { randInt } from '../shared/rng'
import type { GameState } from '../game-state'
import { isCaptive } from '../world/queries'
import { runAiDiplomacy } from './ai-diplomacy'

function withOfficer(
  s: GameState,
  id: string,
  patch: Partial<GameState['officers'][string]>
): GameState {
  return { ...s, officers: { ...s.officers, [id]: { ...s.officers[id]!, ...patch } } }
}

/** ye 仅 simayi 在任（zhangliao busy）。 */
function singleServing(seed: number): GameState {
  return withOfficer(createInitialState(seed), 'zhangliao', { busy: true })
}

// 敌方（刘备）在任非君主：guanyu/pangtong/zhangfei/zhugeliang；太守(非君主)：guanyu(江陵)；敌君主：liubei
describe('runAiDiplomacy 5.5.3 入队分支', () => {
  it('roll 3/4/5/6 按池入队对应外交命令并置 busy；池映射正确', () => {
    for (let seed = 1; seed <= 80; seed++) {
      const s = singleServing(seed)
      const [roll] = randInt(s.rng, 0, 7)
      if (roll < 3 || roll === 7) continue
      const out = runAiDiplomacy(s, 'ye')
      const cmd = out.pendingCommands.at(-1)!
      expect(out.officers.simayi!.busy).toBe(true)
      if (roll === 3) expect(cmd.type).toBe('alienate')
      if (roll === 4) expect(cmd.type).toBe('entice')
      if (roll === 5) {
        expect(cmd.type).toBe('instigate')
        expect((cmd as { targetOfficerId: string }).targetOfficerId).toBe('guanyu')
      }
      if (roll === 6) {
        expect(cmd.type).toBe('induce')
        expect((cmd as { targetOfficerId: string }).targetOfficerId).toBe('liubei')
      }
      if (roll === 3 || roll === 4) {
        expect(['guanyu', 'pangtong', 'zhangfei', 'zhugeliang']).toContain(
          (cmd as { targetOfficerId: string }).targetOfficerId
        )
      }
    }
  })

  it('roll 2/7 跳过（不入队、不占人）', () => {
    for (let seed = 1; seed <= 80; seed++) {
      const s = singleServing(seed)
      const [roll] = randInt(s.rng, 0, 7)
      if (roll !== 2 && roll !== 7) continue
      const out = runAiDiplomacy(s, 'ye')
      expect(out.pendingCommands).toEqual([])
      expect(out.officers.simayi!.busy).toBe(false)
    }
  })
})

describe('runAiDiplomacy 即时招降/处斩', () => {
  /** 把关羽（刘备）放进 ye → 派生俘虏；ye 在任仅 simayi。 */
  function withCaptive(seed: number): GameState {
    let s = singleServing(seed)
    s = withOfficer(s, 'guanyu', { cityId: 'ye' })
    return s
  }

  it('有俘虏：roll 0 即时招降（俘虏归己、转非俘虏）/ roll 1 即时处斩（删除）', () => {
    let sawSuborn = false
    let sawBehead = false
    for (let seed = 1; seed <= 120; seed++) {
      const s = withCaptive(seed)
      expect(isCaptive(s, 'guanyu')).toBe(true)
      const [roll] = randInt(s.rng, 0, 7)
      const out = runAiDiplomacy(s, 'ye')
      if (roll === 0) {
        sawSuborn = true
        expect(out.officers.guanyu!.lordId).toBe('caocao')
        expect(isCaptive(out, 'guanyu')).toBe(false)
        expect(out.officers.simayi!.busy).toBe(false) // 即时、不占人
      } else if (roll === 1) {
        sawBehead = true
        expect(out.officers.guanyu).toBeUndefined()
        expect(out.officers.simayi!.busy).toBe(false)
      }
    }
    expect(sawSuborn).toBe(true)
    expect(sawBehead).toBe(true)
  })

  it('无俘虏：roll 0/1 跳过', () => {
    for (let seed = 1; seed <= 80; seed++) {
      const s = singleServing(seed) // ye 无俘虏
      const [roll] = randInt(s.rng, 0, 7)
      if (roll !== 0 && roll !== 1) continue
      const out = runAiDiplomacy(s, 'ye')
      expect(out.officers).toEqual(s.officers)
      expect(out.pendingCommands).toEqual([])
    }
  })
})

describe('runAiDiplomacy 确定性', () => {
  it('相同 seed 两次一致；不产生 campaign', () => {
    const s = createInitialState(5)
    const a = runAiDiplomacy(s, 'ye')
    expect(a).toEqual(runAiDiplomacy(s, 'ye'))
    expect(a.pendingCommands.some((c) => c.type === 'campaign')).toBe(false)
  })
})

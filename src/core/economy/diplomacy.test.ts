import { describe, it, expect } from 'vitest';
import { createInitialState } from '../world/fixture';
import { DEFAULT_CONFIG } from '../shared/config';
import type { GameState } from '../game-state';
import {
  canEntice,
  entice,
  executeEntice,
  canAlienate,
  executeAlienate,
  canInstigate,
  executeInstigate,
  canInduce,
  induce,
  executeInduce,
} from './diplomacy';
import { isCaptive } from '../world/queries';
import { randInt } from '../shared/rng';

const cfg = DEFAULT_CONFIG;

function withOfficer(
  s: GameState,
  id: string,
  patch: Partial<GameState['officers'][string]>,
): GameState {
  return { ...s, officers: { ...s.officers, [id]: { ...s.officers[id]!, ...patch } } };
}
function withCity(
  s: GameState,
  id: string,
  patch: Partial<GameState['cities'][string]>,
): GameState {
  return { ...s, cities: { ...s.cities, [id]: { ...s.cities[id]!, ...patch } } };
}
function setCityLord(s: GameState, cityId: string, lordId: string): GameState {
  return { ...s, cities: { ...s.cities, [cityId]: { ...s.cities[cityId]!, lordId } } };
}
function withWanderer(s: GameState, id: string, cityId: string): GameState {
  const o = { ...s.officers.guojia!, id, name: id, lordId: null, cityId, busy: false };
  return { ...s, officers: { ...s.officers, [id]: o } };
}

// 执行人=关羽（江陵·刘备）；敌方在任非君主=荀彧（许昌·曹操）。
describe('canEntice / canAlienate（敌方在任非君主武将）', () => {
  it('满足条件通过', () => {
    expect(canEntice(createInitialState(1), 'guanyu', 'xunyu', cfg).ok).toBe(true);
    expect(canAlienate(createInitialState(1), 'guanyu', 'xunyu', cfg).ok).toBe(true);
  });
  it('目标为君主 -> 拒绝', () => {
    expect(canEntice(createInitialState(1), 'guanyu', 'caocao', cfg).ok).toBe(false);
  });
  it('目标为己方 -> 拒绝', () => {
    expect(canEntice(createInitialState(1), 'guanyu', 'zhugeliang', cfg).ok).toBe(false);
  });
  it('目标为在野 -> 拒绝', () => {
    const s = withWanderer(createInitialState(1), 'ronin', 'xuchang');
    expect(canEntice(s, 'guanyu', 'ronin', cfg).ok).toBe(false);
  });
  it('目标为俘虏 -> 拒绝', () => {
    const s = setCityLord(createInitialState(1), 'xuchang', 'liubei'); // 荀彧成俘虏
    expect(canEntice(s, 'guanyu', 'xunyu', cfg).ok).toBe(false);
  });
  it('执行人占用 / 体力不足 / 城金不足 -> 拒绝', () => {
    expect(
      canEntice(
        withOfficer(createInitialState(1), 'guanyu', { busy: true }),
        'guanyu',
        'xunyu',
        cfg,
      ).ok,
    ).toBe(false);
    expect(
      canEntice(
        withOfficer(createInitialState(1), 'guanyu', { stamina: 10 }),
        'guanyu',
        'xunyu',
        cfg,
      ).ok,
    ).toBe(false);
    expect(
      canEntice(withCity(createInitialState(1), 'jiangling', { gold: 0 }), 'guanyu', 'xunyu', cfg)
        .ok,
    ).toBe(false);
  });
});

describe('下令（占人 + 入队 + 不动 RNG）', () => {
  it('entice：扣体力20/城金50、busy、入队、rng 不变', () => {
    const s = createInitialState(1);
    const next = entice(s, 'guanyu', 'xunyu', cfg);
    expect(next.officers.guanyu!.stamina).toBe(s.officers.guanyu!.stamina - 20);
    expect(next.officers.guanyu!.busy).toBe(true);
    expect(next.cities.jiangling!.gold).toBe(s.cities.jiangling!.gold - 50);
    expect(next.pendingCommands).toContainEqual({
      type: 'entice',
      officerId: 'guanyu',
      targetOfficerId: 'xunyu',
    });
    expect(next.rng).toEqual(s.rng);
  });
  it('induce：扣体力10/城金50（城池压制满足时）', () => {
    const s = setCityLord(createInitialState(1), 'ye', 'liubei'); // 刘备3城、曹操1城 -> 压制满足
    const next = induce(s, 'guanyu', 'caocao', cfg);
    expect(next.officers.guanyu!.stamina).toBe(s.officers.guanyu!.stamina - 10);
    expect(next.pendingCommands).toContainEqual({
      type: 'induce',
      officerId: 'guanyu',
      targetOfficerId: 'caocao',
    });
  });
  it('前置不满足 -> no-op', () => {
    const s = withCity(createInitialState(1), 'jiangling', { gold: 0 });
    expect(entice(s, 'guanyu', 'xunyu', cfg)).toBe(s);
  });
});

describe('executeEntice（招揽三关：无 +50 安全线）', () => {
  it('智力差关失败（纯按差）：目标不变、仅消耗 R1', () => {
    let s = createInitialState(1);
    s = withOfficer(s, 'guanyu', { intelligence: 1 });
    s = withOfficer(s, 'xunyu', { intelligence: 100 });
    const [, rng1] = randInt(s.rng, 0, 99);
    const next = executeEntice(s, 'guanyu', 'xunyu');
    expect(next.officers.xunyu!.lordId).toBe('caocao');
    expect(next.officers.xunyu!.cityId).toBe('xuchang');
    expect(next.rng).toEqual(rng1);
  });

  it('三关全过：迁入执行人城、归己、忠诚 RandInt(40,79)', () => {
    // seed1 rolls [67,53,19]；exec100/target1/loyalty0/怕死(coeff40)：R1≤99过、R2<0永不过故过、R3=19<40过
    let s = createInitialState(1);
    s = withOfficer(s, 'guanyu', { intelligence: 100 });
    s = withOfficer(s, 'xunyu', { intelligence: 1, loyalty: 0, personality: 3 });
    const next = executeEntice(s, 'guanyu', 'xunyu');
    expect(next.officers.xunyu!.lordId).toBe('liubei');
    expect(next.officers.xunyu!.cityId).toBe('jiangling');
    expect(isCaptive(next, 'xunyu')).toBe(false);
    expect(next.officers.xunyu!.loyalty).toBeGreaterThanOrEqual(40);
    expect(next.officers.xunyu!.loyalty).toBeLessThanOrEqual(79);
  });

  it('性格关失败（忠义 coeff5，R3=19≥5）：目标不变', () => {
    let s = createInitialState(1);
    s = withOfficer(s, 'guanyu', { intelligence: 100 });
    s = withOfficer(s, 'xunyu', { intelligence: 1, loyalty: 0, personality: 0 });
    const next = executeEntice(s, 'guanyu', 'xunyu');
    expect(next.officers.xunyu!.lordId).toBe('caocao');
  });

  it('守卫：目标已非合法（已归己）-> 原样返回', () => {
    const s = withOfficer(createInitialState(1), 'xunyu', { lordId: 'liubei' });
    expect(executeEntice(s, 'guanyu', 'xunyu')).toBe(s);
  });
});

describe('executeAlienate（离间：安全线+50，成功仅 −4）', () => {
  it('成功：忠诚 −4（下限0）', () => {
    // seed1；exec100/target1/loyalty50/卤莽(coeff50)：R1过、R2=53≥50过、R3=19<50过
    let s = createInitialState(1);
    s = withOfficer(s, 'guanyu', { intelligence: 100 });
    s = withOfficer(s, 'xunyu', { intelligence: 1, loyalty: 50, personality: 4 });
    const next = executeAlienate(s, 'guanyu', 'xunyu');
    expect(next.officers.xunyu!.loyalty).toBe(46);
    expect(next.officers.xunyu!.lordId).toBe('caocao'); // 不改归属
  });
  it('性格关失败：忠诚不变', () => {
    let s = createInitialState(1);
    s = withOfficer(s, 'guanyu', { intelligence: 100 });
    s = withOfficer(s, 'xunyu', { intelligence: 1, loyalty: 50, personality: 0 }); // 忠义coeff5, R3=19≥5
    const next = executeAlienate(s, 'guanyu', 'xunyu');
    expect(next.officers.xunyu!.loyalty).toBe(50);
  });
});

describe('canInstigate（敌方太守，非君主）', () => {
  it('目标为敌城太守（邺城无君主 -> 司马懿96最高）-> 通过', () => {
    expect(canInstigate(createInitialState(1), 'guanyu', 'simayi', cfg).ok).toBe(true);
  });
  it('目标非太守（许昌郭嘉，曹操在城即太守）-> 拒绝', () => {
    expect(canInstigate(createInitialState(1), 'guanyu', 'guojia', cfg).ok).toBe(false);
  });
  it('目标为君主 -> 拒绝', () => {
    expect(canInstigate(createInitialState(1), 'guanyu', 'caocao', cfg).ok).toBe(false);
  });
});

describe('executeInstigate（策反：自立为君）', () => {
  it('成功：目标自立、其城与同势力武将切归目标、不触发重选', () => {
    // seed1；guanyu intel120 vs simayi96：阈值120-96+50=74≥67过；simayi loyalty0过；大志(coeff60)R3=19<60过
    let s = createInitialState(1);
    s = withOfficer(s, 'guanyu', { intelligence: 120 });
    s = withOfficer(s, 'simayi', { loyalty: 0 }); // 性格=1 大志
    const next = executeInstigate(s, 'guanyu', 'simayi');
    expect(next.officers.simayi!.lordId).toBe('simayi');
    expect(next.cities.ye!.lordId).toBe('simayi');
    expect(next.officers.zhangliao!.lordId).toBe('simayi'); // 同城原势力武将随之
    expect(next.officers.caocao!.lordId).toBe('caocao'); // 许昌君主不受影响
    expect(next.cities.xuchang!.lordId).toBe('caocao');
  });
});

describe('canInduce / executeInduce（劝降敌君主，城池压制）', () => {
  it('城池压制不足（2 vs 2）-> 拒绝', () => {
    expect(canInduce(createInitialState(1), 'guanyu', 'caocao', cfg).ok).toBe(false);
  });
  it('城池压制满足（3 vs 1）-> 通过', () => {
    const s = setCityLord(createInitialState(1), 'ye', 'liubei');
    expect(canInduce(s, 'guanyu', 'caocao', cfg).ok).toBe(true);
  });

  it('成功：吸收全部城与城内臣属，散落武将转在野', () => {
    // ye 划归刘备 -> 曹操仅许昌；seed5 rolls[84,1,16]；guanyu intel130 vs caocao90：阈值130-90+50=90≥84过；奸诈(coeff20)R2=1<20过
    let s = setCityLord(createInitialState(5), 'ye', 'liubei');
    s = withOfficer(s, 'guanyu', { intelligence: 130 });
    const next = executeInduce(s, 'guanyu', 'caocao');
    expect(next.cities.xuchang!.lordId).toBe('liubei');
    expect(next.officers.caocao!.lordId).toBe('liubei'); // 君主本人并入
    expect(next.officers.xunyu!.lordId).toBe('liubei');
    expect(next.officers.guojia!.lordId).toBe('liubei');
    // 司马懿/张辽在邺城（已归刘备、非曹操城内）-> 转在野
    expect(next.officers.simayi!.lordId).toBeNull();
    expect(next.officers.zhangliao!.lordId).toBeNull();
  });

  it('玩家君主免疫：目标为玩家君主 -> 直接失败、不动 RNG', () => {
    // 让刘备仅 1 城（江陵），曹操 3 城 -> 压制满足；执行人=司马懿（曹操·邺城）
    let s = createInitialState(1);
    s = setCityLord(s, 'chengdu', 'caocao');
    s = withOfficer(s, 'liubei', { cityId: 'jiangling' }); // 刘备移江陵，仍为江陵之主、非俘虏
    const next = executeInduce(s, 'simayi', 'liubei');
    expect(next).toBe(s); // 免疫：原样返回（同引用）
  });
});

describe('端到端（game.apply + endMonth）', () => {
  it('招揽经下令+月末执行：执行人回城、队列清空', async () => {
    const { apply } = await import('../game');
    const s0 = createInitialState(1);
    const s1 = apply(s0, { type: 'entice', officerId: 'guanyu', targetOfficerId: 'xunyu' });
    expect(s1.pendingCommands).toHaveLength(1);
    const s2 = apply(s1, { type: 'endMonth' });
    expect(s2.pendingCommands).toHaveLength(0);
    expect(s2.officers.guanyu!.busy).toBe(false);
  });

  it('可复现：相同种子整段推进结果一致', async () => {
    const { apply } = await import('../game');
    const run = () => {
      let s = createInitialState(7);
      s = apply(s, { type: 'entice', officerId: 'guanyu', targetOfficerId: 'xunyu' });
      s = apply(s, { type: 'instigate', officerId: 'zhangfei', targetOfficerId: 'simayi' });
      return apply(s, { type: 'endMonth' });
    };
    expect(run()).toEqual(run());
  });
});

import type { Position } from '../shared/position';
import type { Rng } from '../shared/rng';
import { randInt } from '../shared/rng';
import type { TroopType } from '../world/troop-type';
import type { Terrain } from './battle-map';
import type { Weather } from './battle-weather';
import { WEATHER_ORDER } from './battle-weather';
import type { BattleStatus } from './battle-status';

/**
 * 战斗技能（计谋）纯规则唯一收敛处：技能定义表 + 9×9 范围掩码 + MP/解锁/倍率链/成功率公式。
 * 全部不读 state、入参传值；数值按 §6.4.1（速查）/§6.4.5（倍率表）/附录 A（掩码）。
 * 本作纳入 27 技：去 21 遁甲 / 26 潜踪 / 28 急行（当前无真实战斗效果）。
 */
export type SkillId = number; // 1..30

export interface SkillDef {
  readonly id: SkillId;
  readonly name: string;
  readonly target: 'enemy' | 'ally' | 'self';
  readonly mp: number;
  readonly baseTroops: number; // 兵力效果基数（敌方扣兵 / 友方恢复），0=无
  readonly baseFood: number; // 破粮基数，0=无
  readonly status?: BattleStatus; // 命中施加的状态
  readonly special?: 'weather' | 'intel' | 'siege'; // 天变 / 谍报 / 围攻
  readonly weatherMul: readonly number[]; // len5，WEATHER_ORDER 序（晴阴风雨雹）
  readonly targetTerrainMul: readonly number[]; // len8，TERRAIN_ORDER 序
  readonly casterTerrainMul: readonly number[]; // len8，TERRAIN_ORDER 序
  readonly targetTroopMul: readonly number[]; // len6，TROOP_ORDER 序
}

/** 地形倍率维序（§6.4.5）：草地/平原/山地/森林/村庄/城池/营寨/河流。 */
export const TERRAIN_ORDER: readonly Terrain[] = [
  'grass',
  'plain',
  'mountain',
  'forest',
  'village',
  'city',
  'camp',
  'river',
];
/** 兵种倍率维序（§6.4.5）：骑/步/弓/水/极/玄。 */
export const TROOP_ORDER: readonly TroopType[] = [
  'cavalry',
  'infantry',
  'archer',
  'navy',
  'elite',
  'mystic',
];

// —— 9×9 掩码（中心=施法者，偏移不含中心）。程序化生成，避免逐张转写出错。 ——
/** 切比雪夫半径 r 的方形环（不含中心）。box(1)=周身 8 格。 */
function box(r: number): readonly Position[] {
  const out: Position[] = [];
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      if (dx === 0 && dy === 0) continue;
      out.push({ x: dx, y: dy });
    }
  return out;
}
/** 曼哈顿距离 ≤ r 的实心菱形（不含中心）。 */
function diamondFilled(r: number): readonly Position[] {
  const out: Position[] = [];
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const d = Math.abs(dx) + Math.abs(dy);
      if (d >= 1 && d <= r) out.push({ x: dx, y: dy });
    }
  return out;
}
/** 曼哈顿距离 === r 的菱形环。diamondRing(1)=十字。 */
function diamondRing(r: number): readonly Position[] {
  const out: Position[] = [];
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      if (Math.abs(dx) + Math.abs(dy) === r) out.push({ x: dx, y: dy });
    }
  return out;
}

/** 每技能 9×9 掩码（附录 A）。self 技能（天变/谍报）无目标 → []。 */
export const RANGE_MASK: Record<SkillId, readonly Position[]> = {
  1: box(1),
  8: box(1),
  12: box(1), // 践踏/奋战/水淹：周身 8
  2: diamondFilled(2),
  6: diamondFilled(2),
  7: diamondFilled(2),
  17: diamondFilled(2), // 冲锋/滚木/落石/援兵
  3: diamondRing(2), // 突击：菱形环 r2
  4: diamondRing(3),
  9: diamondRing(3),
  10: diamondRing(3),
  11: diamondRing(3), // 突袭/飞矢/箭雨/火箭
  13: diamondRing(1), // 撞击：十字
  5: diamondFilled(3),
  14: diamondFilled(3),
  15: diamondFilled(3),
  16: diamondFilled(3),
  18: diamondFilled(3),
  19: diamondFilled(3),
  20: diamondFilled(3),
  23: diamondFilled(3),
  24: diamondFilled(3),
  25: diamondFilled(3),
  27: diamondFilled(3),
  29: diamondFilled(4), // 援军：实心菱形 r4
  22: [],
  30: [], // 天变/谍报：无目标
};

// —— 技能定义表（§6.4.1 + §6.4.5），仅纳入 27 技。 ——
export const SKILL_DEFS: Record<SkillId, SkillDef> = {
  1: {
    id: 1,
    name: '践踏',
    target: 'enemy',
    mp: 15,
    baseTroops: 400,
    baseFood: 0,
    weatherMul: [100, 100, 100, 100, 0],
    targetTerrainMul: [100, 100, 0, 50, 0, 0, 0, 0],
    casterTerrainMul: [100, 100, 100, 100, 100, 100, 100, 0],
    targetTroopMul: [0, 100, 80, 100, 0, 100],
  },
  2: {
    id: 2,
    name: '冲锋',
    target: 'enemy',
    mp: 20,
    baseTroops: 800,
    baseFood: 0,
    weatherMul: [100, 100, 100, 100, 100],
    targetTerrainMul: [100, 100, 0, 50, 0, 0, 0, 0],
    casterTerrainMul: [100, 100, 100, 100, 80, 80, 80, 0],
    targetTroopMul: [80, 100, 80, 100, 80, 100],
  },
  3: {
    id: 3,
    name: '突击',
    target: 'enemy',
    mp: 25,
    baseTroops: 1000,
    baseFood: 0,
    weatherMul: [100, 100, 100, 100, 0],
    targetTerrainMul: [0, 0, 0, 0, 100, 100, 100, 0],
    casterTerrainMul: [100, 100, 100, 100, 100, 100, 100, 0],
    targetTroopMul: [100, 100, 80, 100, 80, 100],
  },
  4: {
    id: 4,
    name: '突袭',
    target: 'enemy',
    mp: 30,
    baseTroops: 1000,
    baseFood: 0,
    status: 'confused',
    weatherMul: [80, 100, 100, 100, 100],
    targetTerrainMul: [100, 100, 100, 100, 80, 100, 100, 0],
    casterTerrainMul: [100, 100, 100, 100, 100, 100, 100, 0],
    targetTroopMul: [80, 100, 60, 100, 80, 100],
  },
  5: {
    id: 5,
    name: '火攻',
    target: 'enemy',
    mp: 15,
    baseTroops: 400,
    baseFood: 0,
    weatherMul: [100, 80, 100, 0, 0],
    targetTerrainMul: [60, 60, 0, 100, 100, 100, 100, 0],
    casterTerrainMul: [100, 100, 100, 100, 100, 100, 100, 100],
    targetTroopMul: [100, 100, 100, 100, 80, 100],
  },
  6: {
    id: 6,
    name: '滚木',
    target: 'enemy',
    mp: 20,
    baseTroops: 800,
    baseFood: 0,
    weatherMul: [100, 100, 100, 100, 0],
    targetTerrainMul: [100, 100, 0, 60, 0, 0, 0, 0],
    casterTerrainMul: [0, 0, 100, 0, 0, 100, 0, 0],
    targetTroopMul: [100, 100, 100, 100, 100, 100],
  },
  7: {
    id: 7,
    name: '落石',
    target: 'enemy',
    mp: 25,
    baseTroops: 1000,
    baseFood: 0,
    weatherMul: [100, 100, 100, 100, 0],
    targetTerrainMul: [100, 100, 0, 60, 0, 0, 0, 100],
    casterTerrainMul: [0, 0, 100, 0, 0, 100, 0, 0],
    targetTroopMul: [100, 100, 100, 100, 100, 100],
  },
  8: {
    id: 8,
    name: '奋战',
    target: 'enemy',
    mp: 30,
    baseTroops: 1000,
    baseFood: 0,
    weatherMul: [100, 100, 100, 80, 0],
    targetTerrainMul: [100, 100, 0, 60, 0, 0, 0, 0],
    casterTerrainMul: [100, 100, 100, 100, 100, 100, 100, 0],
    targetTroopMul: [100, 90, 100, 100, 80, 100],
  },
  9: {
    id: 9,
    name: '飞矢',
    target: 'enemy',
    mp: 15,
    baseTroops: 500,
    baseFood: 0,
    weatherMul: [100, 100, 100, 100, 0],
    targetTerrainMul: [100, 100, 80, 60, 80, 80, 80, 100],
    casterTerrainMul: [80, 80, 100, 100, 100, 100, 100, 100],
    targetTroopMul: [100, 80, 100, 100, 100, 100],
  },
  10: {
    id: 10,
    name: '箭雨',
    target: 'enemy',
    mp: 20,
    baseTroops: 800,
    baseFood: 0,
    weatherMul: [100, 100, 100, 100, 0],
    targetTerrainMul: [100, 100, 80, 60, 80, 80, 80, 100],
    casterTerrainMul: [80, 80, 100, 100, 100, 100, 100, 100],
    targetTroopMul: [100, 80, 100, 100, 100, 100],
  },
  11: {
    id: 11,
    name: '火箭',
    target: 'enemy',
    mp: 25,
    baseTroops: 0,
    baseFood: 150,
    weatherMul: [100, 80, 100, 0, 0],
    targetTerrainMul: [0, 0, 0, 0, 100, 100, 100, 0],
    casterTerrainMul: [100, 100, 100, 100, 100, 100, 100, 100],
    targetTroopMul: [100, 100, 100, 100, 100, 100],
  },
  12: {
    id: 12,
    name: '水淹',
    target: 'enemy',
    mp: 20,
    baseTroops: 800,
    baseFood: 0,
    weatherMul: [80, 80, 80, 100, 0],
    targetTerrainMul: [0, 0, 0, 0, 0, 0, 0, 100],
    casterTerrainMul: [100, 100, 100, 100, 100, 100, 100, 100],
    targetTroopMul: [100, 100, 100, 50, 100, 100],
  },
  13: {
    id: 13,
    name: '撞击',
    target: 'enemy',
    mp: 30,
    baseTroops: 1000,
    baseFood: 0,
    weatherMul: [100, 100, 100, 100, 0],
    targetTerrainMul: [0, 0, 0, 0, 0, 0, 0, 100],
    casterTerrainMul: [0, 0, 0, 0, 0, 0, 0, 100],
    targetTroopMul: [100, 100, 100, 80, 100, 100],
  },
  14: {
    id: 14,
    name: '咒封',
    target: 'enemy',
    mp: 15,
    baseTroops: 0,
    baseFood: 0,
    status: 'sealed',
    weatherMul: [100, 100, 100, 100, 0],
    targetTerrainMul: [100, 100, 100, 100, 100, 100, 100, 100],
    casterTerrainMul: [100, 100, 100, 100, 100, 100, 100, 0],
    targetTroopMul: [80, 80, 80, 80, 80, 80],
  },
  15: {
    id: 15,
    name: '定身',
    target: 'enemy',
    mp: 20,
    baseTroops: 0,
    baseFood: 0,
    status: 'rooted',
    weatherMul: [100, 100, 100, 100, 0],
    targetTerrainMul: [100, 100, 100, 100, 100, 100, 100, 100],
    casterTerrainMul: [100, 100, 100, 100, 100, 100, 100, 0],
    targetTroopMul: [80, 80, 80, 80, 80, 80],
  },
  16: {
    id: 16,
    name: '流言',
    target: 'enemy',
    mp: 20,
    baseTroops: 0,
    baseFood: 0,
    status: 'confused',
    weatherMul: [100, 100, 100, 100, 0],
    targetTerrainMul: [100, 100, 100, 100, 100, 100, 100, 100],
    casterTerrainMul: [100, 100, 100, 100, 100, 100, 100, 0],
    targetTroopMul: [80, 80, 80, 80, 80, 80],
  },
  17: {
    id: 17,
    name: '援兵',
    target: 'ally',
    mp: 15,
    baseTroops: 800,
    baseFood: 0,
    weatherMul: [100, 100, 100, 100, 0],
    targetTerrainMul: [100, 100, 100, 100, 100, 100, 100, 100],
    casterTerrainMul: [100, 100, 100, 100, 100, 100, 100, 100],
    targetTroopMul: [100, 100, 100, 100, 100, 100],
  },
  18: {
    id: 18,
    name: '烈火',
    target: 'enemy',
    mp: 30,
    baseTroops: 1200,
    baseFood: 0,
    weatherMul: [100, 80, 100, 0, 0],
    targetTerrainMul: [80, 80, 0, 100, 100, 100, 100, 0],
    casterTerrainMul: [100, 100, 100, 100, 100, 100, 100, 100],
    targetTroopMul: [100, 100, 100, 100, 100, 100],
  },
  19: {
    id: 19,
    name: '海啸',
    target: 'enemy',
    mp: 30,
    baseTroops: 1200,
    baseFood: 0,
    weatherMul: [80, 80, 100, 100, 0],
    targetTerrainMul: [0, 0, 0, 0, 0, 0, 0, 100],
    casterTerrainMul: [100, 100, 100, 100, 100, 100, 100, 100],
    targetTroopMul: [100, 100, 100, 70, 100, 100],
  },
  20: {
    id: 20,
    name: '奇门',
    target: 'ally',
    mp: 20,
    baseTroops: 0,
    baseFood: 0,
    status: 'qimen',
    weatherMul: [100, 100, 100, 100, 0],
    targetTerrainMul: [100, 100, 100, 100, 100, 100, 100, 100],
    casterTerrainMul: [100, 100, 100, 100, 100, 100, 100, 100],
    targetTroopMul: [80, 80, 80, 80, 80, 80],
  },
  22: {
    id: 22,
    name: '天变',
    target: 'self',
    mp: 10,
    baseTroops: 0,
    baseFood: 0,
    special: 'weather',
    weatherMul: [100, 100, 100, 100, 100],
    targetTerrainMul: [100, 100, 100, 100, 100, 100, 100, 100],
    casterTerrainMul: [100, 100, 100, 100, 100, 100, 100, 100],
    targetTroopMul: [80, 80, 80, 80, 80, 80],
  },
  23: {
    id: 23,
    name: '石阵',
    target: 'enemy',
    mp: 20,
    baseTroops: 0,
    baseFood: 0,
    status: 'stone',
    weatherMul: [100, 100, 100, 100, 0],
    targetTerrainMul: [80, 80, 100, 100, 0, 0, 0, 100],
    casterTerrainMul: [100, 100, 100, 100, 100, 100, 100, 100],
    targetTroopMul: [80, 80, 80, 80, 80, 80],
  },
  24: {
    id: 24,
    name: '陷阱',
    target: 'ally',
    mp: 10,
    baseTroops: 800,
    baseFood: 0,
    weatherMul: [100, 100, 100, 100, 0],
    targetTerrainMul: [100, 100, 100, 100, 0, 0, 0, 100],
    casterTerrainMul: [100, 100, 100, 100, 100, 100, 100, 100],
    targetTroopMul: [100, 100, 100, 100, 100, 100],
  },
  25: {
    id: 25,
    name: '天籁',
    target: 'ally',
    mp: 10,
    baseTroops: 0,
    baseFood: 0,
    status: 'confused',
    weatherMul: [100, 100, 100, 100, 0],
    targetTerrainMul: [100, 100, 100, 100, 100, 100, 100, 100],
    casterTerrainMul: [100, 100, 100, 100, 100, 100, 100, 100],
    targetTroopMul: [80, 80, 80, 80, 80, 80],
  },
  27: {
    id: 27,
    name: '围攻',
    target: 'enemy',
    mp: 30,
    baseTroops: 0,
    baseFood: 0,
    special: 'siege',
    weatherMul: [100, 100, 100, 100, 0],
    targetTerrainMul: [100, 100, 100, 100, 100, 100, 100, 100],
    casterTerrainMul: [100, 100, 100, 100, 100, 100, 100, 100],
    targetTroopMul: [80, 80, 80, 80, 80, 80],
  },
  29: {
    id: 29,
    name: '援军',
    target: 'ally',
    mp: 30,
    baseTroops: 1800,
    baseFood: 0,
    weatherMul: [100, 100, 100, 100, 0],
    targetTerrainMul: [100, 100, 100, 100, 100, 100, 100, 100],
    casterTerrainMul: [100, 100, 100, 100, 100, 100, 100, 100],
    targetTroopMul: [100, 100, 100, 100, 100, 100],
  },
  30: {
    id: 30,
    name: '谍报',
    target: 'self',
    mp: 10,
    baseTroops: 0,
    baseFood: 0,
    special: 'intel',
    weatherMul: [100, 100, 100, 100, 100],
    targetTerrainMul: [0, 0, 0, 0, 0, 0, 0, 0],
    casterTerrainMul: [100, 100, 100, 100, 100, 100, 100, 100],
    targetTroopMul: [0, 0, 0, 0, 0, 0],
  },
};

/** 各兵种默认技能（有序，随等级解锁取前 N）。 */
export const DEFAULT_SKILLS: Record<TroopType, readonly SkillId[]> = {
  cavalry: [1, 2, 3], // 践踏/冲锋/突击
  infantry: [5, 6, 7, 8], // 火攻/滚木/落石/奋战
  archer: [9, 10, 11], // 飞矢/箭雨/火箭
  navy: [12, 13, 11], // 水淹/撞击/火箭
  elite: [1, 2, 3, 4], // 践踏/冲锋/突击/突袭
  mystic: [14, 15, 16, 17, 18, 19, 20, 29, 27], // 咒封/定身/流言/援兵/烈火/海啸/奇门/援军/围攻
};

/** 君主额外技能：谍报。 */
export const LORD_SKILLS: readonly SkillId[] = [30];

/** 初始 MP（吃有效武力/智力）= floor((floor(智力×80/100)+floor(sqrt(武力)/2)+等级)×体力/100)。 */
export function initialMp(
  effIntel: number,
  effForce: number,
  level: number,
  stamina: number,
): number {
  const core = Math.floor((effIntel * 80) / 100) + Math.floor(Math.sqrt(effForce) / 2) + level;
  return Math.floor((core * stamina) / 100);
}

/** 已解锁默认技能数 = min(floor(默认数×等级/21)+1, 默认数)。 */
export function unlockedCount(defaultCount: number, level: number): number {
  return Math.min(Math.floor((defaultCount * level) / 21) + 1, defaultCount);
}

/** 当前可用技能集 = 已解锁默认 ∪ 个人技能 ∪（君主则 LORD_SKILLS）。 */
export function availableSkills(
  troopType: TroopType,
  level: number,
  personal: readonly number[],
  isLord: boolean,
): Set<SkillId> {
  const defaults = DEFAULT_SKILLS[troopType];
  const n = unlockedCount(defaults.length, level);
  const set = new Set<SkillId>(defaults.slice(0, n));
  for (const s of personal) set.add(s);
  if (isLord) for (const s of LORD_SKILLS) set.add(s);
  return set;
}

/** 倍率链（§6.4.4，每步 floor）：天气 → 目标兵种 → 目标地形 → 施法者地形。 */
export function effectValue(
  base: number,
  mulWeather: number,
  mulTargetTroop: number,
  mulTargetTerrain: number,
  mulCasterTerrain: number,
): number {
  const v1 = Math.floor((base * mulWeather) / 100);
  const v2 = Math.floor((v1 * mulTargetTroop) / 100);
  const v3 = Math.floor((v2 * mulTargetTerrain) / 100);
  return Math.floor((v3 * mulCasterTerrain) / 100);
}

export function weatherMul(def: SkillDef, w: Weather): number {
  return def.weatherMul[WEATHER_ORDER.indexOf(w)]!;
}
export function targetTerrainMul(def: SkillDef, t: Terrain): number {
  return def.targetTerrainMul[TERRAIN_ORDER.indexOf(t)]!;
}
export function casterTerrainMul(def: SkillDef, t: Terrain): number {
  return def.casterTerrainMul[TERRAIN_ORDER.indexOf(t)]!;
}
export function targetTroopMul(def: SkillDef, tt: TroopType): number {
  return def.targetTroopMul[TROOP_ORDER.indexOf(tt)]!;
}

/**
 * 可用性四关（§6.4.2）：天气≠0 且 施法者地形≠0；
 * 当目标为敌/友（需选格）时再要求 目标地形≠0 且 目标兵种≠0。self 技能不看目标维度。
 */
export function skillGatesPass(
  def: SkillDef,
  weather: Weather,
  casterTerrain: Terrain,
  target?: { terrain: Terrain; troop: TroopType },
): boolean {
  if (weatherMul(def, weather) === 0) return false;
  if (casterTerrainMul(def, casterTerrain) === 0) return false;
  if (target) {
    if (targetTerrainMul(def, target.terrain) === 0) return false;
    if (targetTroopMul(def, target.troop) === 0) return false;
  }
  return true;
}

/**
 * 成功率（§6.4.3，消耗 rng）：施法能力=施法者有效智力+等级+5；目标抗性=目标有效智力+等级+5（self→0）。
 * R=randInt(0, 目标抗性+19)；R ≤ floor(施法能力/2) 成功，否则失败。失败也推进 rng（外部仍扣 MP）。
 */
export function rollSkillSuccess(
  castAbility: number,
  targetResist: number,
  rng: Rng,
): readonly [boolean, Rng] {
  const [r, next] = randInt(rng, 0, targetResist + 19);
  return [r <= Math.floor(castAbility / 2), next];
}

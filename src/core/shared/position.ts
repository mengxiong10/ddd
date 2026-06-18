/** 战棋格坐标值对象。零依赖，供战斗地图/走位/攻击范围共用。 */
export interface Position {
  readonly x: number
  readonly y: number
}

/** 两格是否同位。 */
export function samePos(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y
}

/** 曼哈顿距离（攻击范围/接敌停步等用）。 */
export function manhattan(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

import type { CityId, OfficerId } from '../shared/ids'

/** 原版三段登场条件：出生时间、指定招募者、目标城。 */
export interface AppearanceConditions {
  readonly birth: number
  readonly recruiterId: OfficerId | null
  readonly cityId: CityId | null
}

export const DEFAULT_APPEARANCE: AppearanceConditions = {
  birth: 0,
  recruiterId: null,
  cityId: null,
}

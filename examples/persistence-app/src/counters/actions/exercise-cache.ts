import { Action, Cache } from '@canopy/core'

export interface ExerciseCacheResult {
  readonly added: boolean
  readonly duplicateAdded: boolean
  readonly incremented: number
  readonly remembered: string
}

export class ExerciseCache extends Action<string, ExerciseCacheResult> {
  static id = 'exercise-cache'
  static override readonly access = 'public'

  constructor(private readonly cache: Cache) { super() }

  async handle(key: string): Promise<ExerciseCacheResult> {
    const added = await this.cache.add(`${key}:counter`, 1, { ttlSeconds: 60 })
    const duplicateAdded = await this.cache.add(`${key}:counter`, 99)
    const incremented = await this.cache.increment(`${key}:counter`, 2)
    const remembered = await this.cache.remember(`${key}:label`, () => 'computed', { ttlSeconds: 60 })
    return { added, duplicateAdded, incremented, remembered }
  }
}

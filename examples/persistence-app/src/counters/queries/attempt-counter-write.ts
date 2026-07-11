import { Query, UnitOfWork } from '@canopy/core'

export class AttemptCounterWrite extends Query<string, number> {
  static id = 'attempt-counter-write'
  static override readonly access = 'public'

  constructor(private readonly unitOfWork: UnitOfWork) {
    super()
  }

  handle(id: string): Promise<number> {
    return this.unitOfWork.saveEntity({
      type: 'counter',
      id,
      state: { value: 1 },
    })
  }
}

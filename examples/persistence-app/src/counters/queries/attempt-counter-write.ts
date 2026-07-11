import { Query, UnitOfWork } from '@doxajs/core'

export class AttemptCounterWrite extends Query<string, number> {
  static id = 'attempt-counter-write'
  static override readonly access = 'public'

  private readonly unitOfWork = this.inject(UnitOfWork)

  handle(id: string): Promise<number> {
    return this.unitOfWork.saveEntity({
      type: 'counter',
      id,
      state: { value: 1 },
    })
  }
}

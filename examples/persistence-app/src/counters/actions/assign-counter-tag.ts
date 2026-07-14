import { Action } from '@doxajs/core'

import { CounterTag, CounterTagAssignment } from '../models/counter.js'

export interface AssignCounterTagInput {
  readonly id: string
  readonly counterId: string
  readonly tagId: string
  readonly tagName: string
}

export class AssignCounterTag extends Action<AssignCounterTagInput, void> {
  static id = 'assign-counter-tag'
  static override readonly access = 'public'

  async handle(input: AssignCounterTagInput): Promise<void> {
    if (!(await CounterTag.find(input.tagId))) {
      await CounterTag.create({ id: input.tagId, name: input.tagName })
    }
    await CounterTagAssignment.create({
      id: input.id,
      counterId: input.counterId,
      tagId: input.tagId,
    })
  }
}

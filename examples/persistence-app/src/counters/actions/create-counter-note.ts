import { Action } from '@doxajs/core'

import { CounterNote } from '../models/counter.js'

export interface CreateCounterNoteInput {
  readonly id: string
  readonly counterId: string
  readonly body: string
  readonly rank: number
}

export class CreateCounterNote extends Action<CreateCounterNoteInput, void> {
  static id = 'create-counter-note'
  static override readonly access = 'public'

  async handle(input: CreateCounterNoteInput): Promise<void> {
    await CounterNote.create(input)
  }
}

import { Action } from '@doxajs/core'

import { CounterCreated } from '../events/counter-created.js'
import { Counter } from '../models/counter.js'

export class CreateDomainCounter extends Action<
  { readonly id: string; readonly value: number; readonly fail?: boolean },
  void
> {
  static readonly id = 'create-domain-counter'
  static override readonly access = 'public'

  async handle(input: { readonly id: string; readonly value: number; readonly fail?: boolean }) {
    const counter = await Counter.create({ id: input.id, value: input.value })
    await CounterCreated.dispatch(counter.id, { value: counter.value })
    if (input.fail) throw new Error('Domain event transaction failed.')
  }
}

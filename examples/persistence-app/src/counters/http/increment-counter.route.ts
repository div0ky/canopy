import { ActionBus, type HttpRequest, Route } from '@canopy/core'
import { z } from 'zod'

import { SaveCounter } from '../actions/save-counter.js'

const IncrementCounterBody = z.object({
  amount: z.number().int().positive(),
})

export class IncrementCounterRoute extends Route {
  static override readonly id = 'increment-counter'
  static override readonly access = 'public'
  readonly method = 'POST'
  readonly path = '/counters/:id/increment'

  private readonly actions = this.inject(ActionBus)

  async handle(request: HttpRequest) {
    const body = await request.validate(IncrementCounterBody, await request.json())
    const result = await this.actions.execute(SaveCounter, {
      id: request.param('id'),
      amount: body.amount,
    })
    return result
  }
}

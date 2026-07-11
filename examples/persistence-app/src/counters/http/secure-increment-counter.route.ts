import { ActionBus, type HttpRequest, Route } from '@doxajs/core'
import { z } from 'zod'

import { SecureIncrementCounter } from '../actions/secure-increment-counter.js'

const Body = z.object({ amount: z.number().int().positive() })

export class SecureIncrementCounterRoute extends Route {
  static override readonly id = 'secure-increment-counter'
  static override readonly access = 'counters.write'
  readonly method = 'POST'
  readonly path = '/secure/counters/:id/increment'

  private readonly actions = this.inject(ActionBus)

  async handle(request: HttpRequest) {
    const body = await request.validate(Body, await request.json())
    return await this.actions.execute(SecureIncrementCounter, {
      id: request.param('id'),
      amount: body.amount,
    })
  }
}

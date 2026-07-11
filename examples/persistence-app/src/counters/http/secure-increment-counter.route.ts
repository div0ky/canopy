import { ActionBus, Http, type HttpRequest, Route } from '@canopy/core'
import { z } from 'zod'

import { SecureIncrementCounter } from '../actions/secure-increment-counter.js'

const Body = z.object({ amount: z.number().int().positive() })

export class SecureIncrementCounterRoute extends Route {
  static override readonly id = 'secure-increment-counter'
  static override readonly access = 'counters.write'
  readonly method = 'POST'
  readonly path = '/secure/counters/:id/increment'

  constructor(private readonly actions: ActionBus) { super() }

  async handle(request: HttpRequest): Promise<Response> {
    const body = await request.validate(Body, await request.json())
    return Http.json(await this.actions.execute(SecureIncrementCounter, {
      id: request.param('id'),
      amount: body.amount,
    }))
  }
}

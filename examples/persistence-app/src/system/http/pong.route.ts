import { type HttpRequest, Route } from '@canopy/core'

import { HttpPinged } from '../events/http-pinged.js'

export class PongRoute extends Route {
  static override readonly id = 'pong'
  static override readonly access = 'public'
  readonly method = 'GET'
  readonly path = '/pong'

  async handle(_request: HttpRequest): Promise<{ message: string }> {
    const message = "ping";
    await HttpPinged.dispatch({ message })
    return { message }
  }
}

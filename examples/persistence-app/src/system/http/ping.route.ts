import { Http, type HttpRequest, Route } from '@canopy/core'

import { HttpPinged } from '../events/http-pinged.js'

export class PingRoute extends Route {
  static override readonly id = 'ping'
  static override readonly access = 'public'
  readonly method = 'POST'
  readonly path = '/ping'

  async handle(request: HttpRequest): Promise<Response> {
    const body = await request.json<{ message?: unknown }>()
    const message = typeof body.message === 'string' ? body.message : 'pong'
    await HttpPinged.dispatch(message)
    return Http.json({ message })
  }
}

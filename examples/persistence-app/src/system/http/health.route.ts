import { type HttpRequest, Route } from '@canopy/core'

export class HealthRoute extends Route {
  static override readonly id = 'health'
  static override readonly access = 'public'
  readonly method = 'GET'
  readonly path = '/health'

  handle(_request: HttpRequest): { status: string } {
    return { status: 'ok' }
  }
}

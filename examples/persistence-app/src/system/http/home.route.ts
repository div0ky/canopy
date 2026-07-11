import { type HttpRequest, Route } from '@canopy/core'

export class HomeRoute extends Route {
  static override readonly id = 'home'
  static override readonly access = 'public'
  readonly method = 'GET'
  readonly path = '/'

  handle(_request: HttpRequest): object {
    this.logger.info('Canopy home visited')
    return {
      name: 'Canopy',
      status: 'growing',
      routes: [
        'GET /',
        'GET /health',
        'GET /hello/:name',
        'POST /auth/register',
        'POST /auth/login',
        'GET /auth/me',
        'POST /auth/logout',
        'POST /auth/tokens',
        'GET /auth/tokens',
        'POST /auth/tokens/:id/rotate',
        'DELETE /auth/tokens/:id',
        'POST /ping',
        'POST /counters/:id/increment',
        'DELETE /counters/:id',
      ],
    }
  }
}

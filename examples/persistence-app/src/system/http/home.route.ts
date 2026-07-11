import { Http, type HttpRequest, Logger, Route } from '@canopy/core'

export class HomeRoute extends Route {
  static override readonly id = 'home'
  static override readonly access = 'public'
  readonly method = 'GET'
  readonly path = '/'

  constructor(private readonly logger: Logger) {
    super()
  }

  handle(_request: HttpRequest): Response {
    this.logger.channel('app').info('Canopy home visited')
    return Http.json({
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
    })
  }
}

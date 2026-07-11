import { Http, type HttpRequest, Route } from '@canopy/core'

export class HelloRoute extends Route {
  static override readonly id = 'hello'
  static override readonly access = 'public'
  readonly method = 'GET'
  readonly path = '/hello/:name'

  handle(request: HttpRequest): Response {
    return Http.json({
      message: `${request.query('greeting') ?? 'Hello'}, ${request.param('name')}!`,
    })
  }
}

import { type HttpRequest, Route } from '@doxajs/core'

export class HelloRoute extends Route {
  static override readonly id = 'hello'
  static override readonly access = 'public'
  readonly method = 'GET'
  readonly path = '/hello/:name'

  handle(request: HttpRequest): { message: string } {
    return {
      message: `${request.query('greeting') ?? 'Hello'}, ${request.param('name')}!`,
    }
  }
}

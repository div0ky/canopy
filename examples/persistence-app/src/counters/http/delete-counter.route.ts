import { ActionBus, Http, type HttpRequest, Route } from '@doxajs/core'

import { DeleteCounter } from '../actions/delete-counter.js'

export class DeleteCounterRoute extends Route {
  static override readonly id = 'delete-counter'
  static override readonly access = 'public'
  readonly method = 'DELETE'
  readonly path = '/counters/:id'

  private readonly actions = this.inject(ActionBus)

  async handle(request: HttpRequest): Promise<Response> {
    await this.actions.execute(DeleteCounter, request.param('id'))
    return Http.noContent()
  }
}

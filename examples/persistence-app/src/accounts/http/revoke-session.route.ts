import { Auth, CurrentExecution, type HttpRequest, Route } from '@doxajs/core'

export class RevokeSessionRoute extends Route {
  static override readonly id = 'revoke-session'
  static override readonly access = 'accounts.sessions.manage'
  readonly method = 'DELETE'
  readonly path = '/auth/sessions/:id'
  private readonly auth = this.inject(Auth)
  private readonly execution = this.inject(CurrentExecution)
  async handle(request: HttpRequest): Promise<Response> {
    const id = request.param('id')
    const sessions = await this.auth.listSessions(this.execution.context.authentication.identityId!)
    if (sessions.some((session) => session.id === id)) await this.auth.revokeSession(id)
    return new Response(null, {
      status: 204,
      ...(id === this.execution.context.authentication.sessionId
        ? { headers: { 'set-cookie': this.auth.expiredSessionCookie() } }
        : {}),
    })
  }
}

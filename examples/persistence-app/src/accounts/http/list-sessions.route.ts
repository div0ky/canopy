import { Auth, CurrentExecution, Http, type HttpRequest, Route } from '@canopy/core'

export class ListSessionsRoute extends Route {
  static override readonly id = 'list-sessions'; static override readonly access = 'accounts.sessions.manage'
  readonly method = 'GET'; readonly path = '/auth/sessions'
  constructor(private readonly auth: Auth, private readonly execution: CurrentExecution) { super() }
  async handle(_request: HttpRequest): Promise<Response> {
    const sessions = await this.auth.listSessions(this.execution.context.authentication.identityId!)
    return Http.json({ sessions: sessions.map((session) => ({
      id: session.id, createdAt: session.createdAt.toISOString(), lastSeenAt: session.lastSeenAt?.toISOString(),
      expiresAt: session.expiresAt.toISOString(), revokedAt: session.revokedAt?.toISOString(),
      current: session.id === this.execution.context.authentication.sessionId,
    })) })
  }
}

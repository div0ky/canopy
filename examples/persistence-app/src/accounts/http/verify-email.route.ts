import { Auth, Http, type HttpRequest, Route } from '@canopy/core'

export class VerifyEmailRoute extends Route {
  static override readonly id = 'verify-email'; static override readonly access = 'public'
  readonly method = 'POST'; readonly path = '/auth/email/verify'
  constructor(private readonly auth: Auth) { super() }
  async handle(request: HttpRequest): Promise<Response> {
    const body = await request.json<{ token?: unknown }>()
    if (typeof body.token !== 'string') return Http.json({ error: { code: 'validation_failed', message: 'token is required' } }, 422)
    const identity = await this.auth.verifyEmail(body.token)
    return Http.json({ identity: { id: identity.id, email: identity.email, emailVerified: identity.emailVerified } })
  }
}

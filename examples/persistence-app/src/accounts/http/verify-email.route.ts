import { Auth, HttpError, type HttpRequest, Route } from '@doxajs/core'

export class VerifyEmailRoute extends Route {
  static override readonly id = 'verify-email'
  static override readonly access = 'public'
  readonly method = 'POST'
  readonly path = '/auth/email/verify'
  private readonly auth = this.inject(Auth)
  async handle(request: HttpRequest) {
    const body = await request.json<{ token?: unknown }>()
    if (typeof body.token !== 'string')
      throw new HttpError(422, 'validation_failed', 'token is required')
    const identity = await this.auth.verifyEmail(body.token)
    return {
      identity: { id: identity.id, email: identity.email, emailVerified: identity.emailVerified },
    }
  }
}

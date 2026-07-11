import { Auth, type HttpRequest, Route } from '@canopy/core'

export class ResetPasswordRoute extends Route {
  static override readonly id = 'reset-password'; static override readonly access = 'public'
  readonly method = 'POST'; readonly path = '/auth/password/reset'
  constructor(private readonly auth: Auth) { super() }
  async handle(request: HttpRequest): Promise<Response> {
    const body = await request.json<{ token?: unknown; password?: unknown }>()
    await this.auth.resetPassword(typeof body.token === 'string' ? body.token : '', typeof body.password === 'string' ? body.password : '')
    return new Response(null, { status: 204 })
  }
}

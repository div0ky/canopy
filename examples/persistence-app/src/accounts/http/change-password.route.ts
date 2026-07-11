import { Auth, CurrentExecution, type HttpRequest, Route } from '@doxajs/core'

export class ChangePasswordRoute extends Route {
  static override readonly id = 'change-password'
  static override readonly access = 'accounts.password.change'
  readonly method = 'POST'
  readonly path = '/auth/password'
  private readonly auth = this.inject(Auth)
  private readonly execution = this.inject(CurrentExecution)
  async handle(request: HttpRequest): Promise<Response> {
    const identityId = this.execution.context.authentication.identityId!
    const body = await request.json<{ currentPassword?: unknown; newPassword?: unknown }>()
    await this.auth.changePassword(
      identityId,
      typeof body.currentPassword === 'string' ? body.currentPassword : '',
      typeof body.newPassword === 'string' ? body.newPassword : '',
    )
    return new Response(null, {
      status: 204,
      headers: { 'set-cookie': this.auth.expiredSessionCookie() },
    })
  }
}

import { randomUUID } from 'node:crypto'

import { Action, Mailer } from '@canopy/core'

export interface SendAuthEmailInput { readonly kind: 'verification' | 'password-reset'; readonly to: string; readonly token: string }

export class SendAuthEmail extends Action<SendAuthEmailInput, void> {
  static id = 'send-auth-email'
  static override readonly access = 'public'
  private readonly mailer = this.inject(Mailer)
  async handle(input: SendAuthEmailInput): Promise<void> {
    await this.mailer.send({
      id: randomUUID(), from: 'accounts@canopy.test', to: [input.to],
      subject: input.kind === 'verification' ? 'Verify your email' : 'Reset your password',
      text: `${input.kind === 'verification' ? 'Verification' : 'Password reset'} token: ${input.token}`,
    })
  }
}

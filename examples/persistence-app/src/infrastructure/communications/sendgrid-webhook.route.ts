import { ActionBus, HttpError, type HttpRequest, Route } from '@canopy/core'
import { normalizeSendGridEvents, verifySendGridWebhook } from '@canopy/sendgrid'

import { CommunicationsConfig } from './communications-config.js'
import { RecordDeliveryUpdates } from './record-delivery-updates.js'

export class SendGridWebhookRoute extends Route {
  static override readonly id = 'sendgrid-webhook'
  static override readonly access = 'public'
  readonly method = 'POST'
  readonly path = '/webhooks/sendgrid'
  constructor(private readonly actions: ActionBus, private readonly config: CommunicationsConfig) { super() }
  async handle(request: HttpRequest): Promise<Response> {
    const raw = await request.text()
    const timestamp = request.header('x-twilio-email-event-webhook-timestamp') ?? ''
    const signature = request.header('x-twilio-email-event-webhook-signature') ?? ''
    const publicKey = this.config.sendGridWebhookPublicKey
    if (!publicKey) throw new HttpError(503, 'webhook_not_configured', 'The SendGrid webhook is not configured.')
    if (!verifySendGridWebhook(raw, timestamp, signature, publicKey.reveal())) {
      throw new HttpError(403, 'invalid_webhook_signature', 'The SendGrid webhook signature is invalid.')
    }
    if (Math.abs(Date.now() / 1_000 - Number(timestamp)) > 300) {
      throw new HttpError(403, 'stale_webhook', 'The SendGrid webhook timestamp is outside the accepted window.')
    }
    await this.actions.execute(RecordDeliveryUpdates, normalizeSendGridEvents(raw))
    return new Response(null, { status: 204 })
  }
}

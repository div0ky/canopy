import { ActionBus, HttpError, type HttpRequest, Route } from '@canopy/core'
import { normalizeTwilioStatus, verifyTwilioWebhook } from '@canopy/twilio-sms'

import { CommunicationsConfig } from './communications-config.js'
import { RecordDeliveryUpdates } from './record-delivery-updates.js'

export class TwilioSmsWebhookRoute extends Route {
  static override readonly id = 'twilio-sms-webhook'
  static override readonly access = 'public'
  readonly method = 'POST'
  readonly path = '/webhooks/twilio/sms'
  private readonly actions = this.inject(ActionBus)
  private readonly config = this.inject(CommunicationsConfig)
  async handle(request: HttpRequest): Promise<Response> {
    const form = new URLSearchParams(await request.text())
    const signedParameters = Object.fromEntries(form.entries())
    const signature = request.header('x-twilio-signature') ?? ''
    const authToken = this.config.twilioAuthToken
    if (!authToken) throw new HttpError(503, 'webhook_not_configured', 'The Twilio webhook is not configured.')
    if (!verifyTwilioWebhook(request.raw.url, signedParameters, signature, authToken.reveal())) {
      throw new HttpError(403, 'invalid_webhook_signature', 'The Twilio webhook signature is invalid.')
    }
    await this.actions.execute(RecordDeliveryUpdates, [normalizeTwilioStatus({
      ...signedParameters,
      CanopyMessageId: request.query('canopy_message_id') ?? '',
    })])
    return new Response(null, { status: 204 })
  }
}

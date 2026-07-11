import { Feature } from '@canopy/core'

import { DatabaseConfig } from './database/database-config.js'
import { CanopyAuth } from './auth/canopy-auth.js'
import { PersistenceTransactions } from './database/persistence-transactions.js'
import { CanopyQueues } from './queue/canopy-queues.js'
import { CanopyCache } from './cache/canopy-cache.js'
import { ReferenceMail } from './communications/reference-mail.js'
import { ReferenceSms } from './communications/reference-sms.js'
import { CommunicationsConfig } from './communications/communications-config.js'
import { RecordDeliveryUpdates } from './communications/record-delivery-updates.js'
import { SendGridWebhookRoute } from './communications/sendgrid-webhook.route.js'
import { TwilioSmsWebhookRoute } from './communications/twilio-sms-webhook.route.js'
import { ReferenceTelemetry } from './telemetry/reference-telemetry.js'
import { ApplicationUndergrowth } from './undergrowth/application-undergrowth.js'

export class InfrastructureFeature extends Feature {
  id = 'infrastructure'
  configs = [DatabaseConfig, CommunicationsConfig]
  providers = [PersistenceTransactions, CanopyQueues, CanopyAuth, CanopyCache, ReferenceMail, ReferenceSms, ReferenceTelemetry, ApplicationUndergrowth]
  actions = [RecordDeliveryUpdates]
  routes = [SendGridWebhookRoute, TwilioSmsWebhookRoute]
}

import { Feature } from '@doxajs/core'

import { DatabaseConfig } from './database/database-config.js'
import { DoxaAuth } from './auth/doxa-auth.js'
import { PersistenceTransactions } from './database/persistence-transactions.js'
import { DoxaQueues } from './queue/doxa-queues.js'
import { DoxaCache } from './cache/doxa-cache.js'
import { ReferenceMail } from './communications/reference-mail.js'
import { ReferenceSms } from './communications/reference-sms.js'
import { CommunicationsConfig } from './communications/communications-config.js'
import { RecordDeliveryUpdates } from './communications/record-delivery-updates.js'
import { SendGridWebhookRoute } from './communications/sendgrid-webhook.route.js'
import { TwilioSmsWebhookRoute } from './communications/twilio-sms-webhook.route.js'
import { ReferenceTelemetry } from './telemetry/reference-telemetry.js'
import { ApplicationTheoria } from './theoria/application-theoria.js'

export class InfrastructureFeature extends Feature {
  id = 'infrastructure'
  configs = [DatabaseConfig, CommunicationsConfig]
  providers = [
    PersistenceTransactions,
    DoxaQueues,
    DoxaAuth,
    DoxaCache,
    ReferenceMail,
    ReferenceSms,
    ReferenceTelemetry,
    ApplicationTheoria,
  ]
  actions = [RecordDeliveryUpdates]
  routes = [SendGridWebhookRoute, TwilioSmsWebhookRoute]
}

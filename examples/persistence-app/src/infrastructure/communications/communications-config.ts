import { Configuration, SecretString } from '@canopy/core'

export class CommunicationsConfig extends Configuration {
  declare sendGridWebhookPublicKey?: SecretString
  declare twilioAuthToken?: SecretString
}

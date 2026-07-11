import { Configuration, SecretString } from '@doxajs/core'

export class CommunicationsConfig extends Configuration {
  declare sendGridWebhookPublicKey?: SecretString
  declare twilioAuthToken?: SecretString
}

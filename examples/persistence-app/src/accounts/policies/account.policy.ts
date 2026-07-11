import {
  allow,
  deny,
  Policy,
  type PolicyDecision,
  type PolicyRequest,
} from '@canopy/core'

export class AccountPolicy extends Policy {
  static override readonly id = 'account'
  static override readonly abilities = [
    'accounts.logout',
    'accounts.password.change',
    'accounts.email.verify',
    'accounts.sessions.manage',
    'accounts.tokens.manage',
    'accounts.view-self',
  ]

  decide(request: PolicyRequest): PolicyDecision {
    if (request.actor.kind !== 'user' || request.context.authentication.state !== 'authenticated') {
      return deny('account', 'authentication_required')
    }
    if (['accounts.tokens.manage', 'accounts.sessions.manage', 'accounts.password.change'].includes(request.ability)
      && (!request.context.authentication.sessionId
        || request.context.authentication.method !== 'password')) {
      return deny('account', 'fresh_session_required')
    }
    return allow('account')
  }
}

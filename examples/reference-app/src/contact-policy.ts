import { allow, deny, Policy, type PolicyDecision, type PolicyRequest } from '@doxajs/core'

interface OwnedContact {
  readonly ownerId?: string
}

export class ContactPolicy extends Policy<OwnedContact> {
  static override readonly id = 'contact'
  static override readonly abilities = ['contact.update']

  decide(request: PolicyRequest<OwnedContact>): PolicyDecision {
    if (request.resource?.ownerId !== request.actor.id) {
      return deny('contact', 'contact_owner_required')
    }
    return allow('contact')
  }
}

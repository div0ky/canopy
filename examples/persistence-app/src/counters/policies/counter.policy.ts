import {
  allow,
  deny,
  Policy,
  type PolicyDecision,
  type PolicyRequest,
} from '@canopy/core'

interface OwnedCounter {
  readonly ownerId: string
}

export class CounterPolicy extends Policy<OwnedCounter> {
  static override readonly id = 'counter'
  static override readonly abilities = ['counters.write', 'counters.update']

  decide(request: PolicyRequest<OwnedCounter>): PolicyDecision {
    if (request.actor.kind !== 'user' || !request.actor.id) {
      return deny('counter', 'authentication_required')
    }
    if (request.ability === 'counters.write' && !request.resource) return allow('counter')
    if (!request.resource || request.resource.ownerId !== request.actor.id) {
      return deny('counter', 'counter_owner_required')
    }
    return allow('counter')
  }
}

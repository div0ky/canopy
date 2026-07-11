import type { ActorRef, ExecutionContext, TenantRef } from './index.js'
import { CanopyRole } from './role.js'

export interface PolicyRequest<Resource = unknown> {
  readonly actor: ActorRef
  readonly ability: string
  readonly resource?: Resource
  readonly tenant?: TenantRef
  readonly context: ExecutionContext
}

export interface PolicyDecision {
  readonly effect: 'allow' | 'deny'
  readonly policy: string
  readonly code: string
}

export abstract class Policy<Resource = unknown> extends CanopyRole {
  static readonly id: string = ''
  static readonly abilities: readonly string[] = []
  abstract decide(request: PolicyRequest<Resource>): PolicyDecision | Promise<PolicyDecision>
}

export class AuthorizationError extends Error {
  override readonly name = 'AuthorizationError'

  constructor(readonly decision: PolicyDecision) {
    super('The current actor is not authorized to perform this operation.')
  }
}

export abstract class Authorization {
  abstract decide<Resource = unknown>(ability: string, resource?: Resource): Promise<PolicyDecision>
  abstract authorize<Resource = unknown>(ability: string, resource?: Resource): Promise<void>
}

export function allow(policy: string, code = 'allowed'): PolicyDecision {
  return Object.freeze({ effect: 'allow', policy, code })
}

export function deny(policy: string, code = 'denied'): PolicyDecision {
  return Object.freeze({ effect: 'deny', policy, code })
}

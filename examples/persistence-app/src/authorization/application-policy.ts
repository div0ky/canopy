import {
  allow,
  Authorization,
  deny,
  Policy,
  type PolicyDecision,
  type PolicyRequest,
} from '@doxajs/core'

import { User } from './models/legacy-access.js'

export interface BranchResource {
  readonly branchTag?: string
}

export const AUTHORIZATION_POLICY_FAILURE_BRANCH = 'authorization-policy-failure'
export const AUTHORIZATION_POLICY_CANCELLATION_BRANCH = 'authorization-policy-cancellation'

export let policyUser: User | undefined
export let nestedPolicyUser: User | undefined
export let policyWriteError: string | undefined

export function resetPolicyProof(): void {
  policyUser = undefined
  nestedPolicyUser = undefined
  policyWriteError = undefined
}

export class ApplicationPolicy extends Policy<BranchResource> {
  static override readonly id = 'application'
  static override readonly abilities = [
    'authorization.branch.override',
    'authorization.contact.read',
  ]

  private readonly authorization = this.inject(Authorization)

  async decide(request: PolicyRequest<BranchResource>): Promise<PolicyDecision> {
    const actorId = request.actor.kind === 'anonymous' ? undefined : request.actor.id
    if (!actorId) return deny('application', 'authentication_required')

    const user = await User.find(actorId)
    policyUser = user
    if (!user) return deny('application', 'user_required')

    if (request.resource?.branchTag === AUTHORIZATION_POLICY_FAILURE_BRANCH) {
      throw new Error('Authorization policy fixture failed.')
    }
    if (request.resource?.branchTag === AUTHORIZATION_POLICY_CANCELLATION_BRANCH) {
      await waitForCancellation(request.context.cancellation)
    }

    try {
      await User.create({
        id: 'authorization-policy-forbidden-create',
        groupId: 'forbidden',
        branchTag: 'forbidden',
      })
    } catch (error) {
      policyWriteError = error instanceof Error ? error.name : String(error)
    }

    if (request.ability === 'authorization.branch.override') {
      nestedPolicyUser = user
      return allow('application')
    }

    const canOverrideBranch =
      (await this.authorization.decide('authorization.branch.override')).effect === 'allow'
    if (
      request.resource?.branchTag &&
      request.resource.branchTag !== user.branchTag &&
      !canOverrideBranch
    ) {
      return deny('application', 'branch_scope_required')
    }
    return allow('application')
  }
}

function waitForCancellation(signal: AbortSignal): Promise<never> {
  if (signal.aborted) return Promise.reject(new Error('Authorization policy fixture cancelled.'))
  return new Promise((_resolve, reject) => {
    signal.addEventListener(
      'abort',
      () => reject(new Error('Authorization policy fixture cancelled.')),
      { once: true },
    )
  })
}

# Default-Deny Authorization Vertical Slice

- **Status:** Implemented proof
- **Implemented:** 2026-07-10
- **MVP status:** Incomplete
- **Depends on:**
  [Actor, Execution Context, and Authorization](../specifications/actor-execution-context-authorization.md)

## Outcome

Authorization is now one Canopy runtime service rather than transport middleware:

```text
Feature policies = [AccountPolicy, CounterPolicy]
  → compiler validates stable abilities and one owning policy
  → manifest v6 records policy graph and dependencies
  → route entry authorizes before handler construction
  → Authorization is injectable in actions, queries, jobs, listeners, schedules, and services
  → bearer constraints may deny before policy
  → application policy evaluates current actor, tenant, context, and optional resource
  → structured decision is durably security-audited
```

## Authoring

```ts
export class CounterPolicy extends Policy<OwnedCounter> {
  static id = 'counter'
  static abilities = ['counters.update']

  decide(request: PolicyRequest<OwnedCounter>): PolicyDecision {
    if (request.actor.kind !== 'user') return deny('counter', 'authentication_required')
    if (request.resource?.ownerId !== request.actor.id) {
      return deny('counter', 'counter_owner_required')
    }
    return allow('counter')
  }
}
```

The Feature declares `policies = [CounterPolicy]`. The compiler rejects duplicate ability owners,
invalid role classes, ambiguous IDs, invalid dependencies, and protected routes whose ability has no
selected policy.

Every route explicitly declares either `static access = 'public'` or a stable ability. Public is a
visible opt-out; omission is a compilation failure. Protected routes authorize before their
constructor or handler runs.

## Decisions and denial

All decisions contain `effect`, canonical manifest policy ID, and a stable code. An undeclared
ability returns `canopy:default-deny / policy_missing`. `authorize()` throws a normalized error for
denial; `decide()` supports tests, diagnostics, and deliberate conditional behavior.

Missing authentication becomes HTTP 401 without exposing policy detail. Other denial becomes a
stable HTTP 403. Internal decisions retain the precise policy and code.

## Bearer constraints

An access token's constraints are upper bounds, never grants. Exact ability, global `*`, and named
prefix wildcards are supported. If a constrained bearer lacks the requested ability, Canopy denies
through `canopy:credential-constraints` before application policy can allow it. Constraints remain
in queue execution envelopes so asynchronous work cannot gain authority through transport.

## Entry and resource phases

Routes, actions, queries, listeners, jobs, and schedules each compile an explicit `public` or
ability access declaration. Protected work authorizes before constructing its handler. The
injectable `Authorization` service remains available in every admitted execution scope for resource
checks after loading domain state. The policy request always receives the current immutable
execution context.

## Security audit

Every allow and deny is recorded through the first-party authentication security store with ability,
effect, canonical policy ID, code, actor reference, execution ID, and correlation ID. Resources and
credential material are never serialized into the audit record. Audit failure fails the
authorization call closed.

## Evidence

The suite contains forty-two passing tests. It proves manifest ownership, automatic HTTP entry
policy, anonymous 401 behavior, structured allow and deny, resource ownership, missing-policy
default denial, bearer constraint denial, durable audit metadata, and the continued behavior of all
prior slices.

## Remaining authorization work

- Compiled access declarations for future command entry roles when Arbor commands arrive.
- Durable delegation grants, impersonation, tenant selection, and revalidation.
- Policy decision capture in journal/outbox metadata in addition to the security audit.
- Authorization fakes/assertions, diagnostics, metrics, and concurrent isolation conformance.

## Next slice

Implement signals and model observers with non-overlapping lifecycle semantics.

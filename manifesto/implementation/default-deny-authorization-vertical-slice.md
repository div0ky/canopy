# Default-Deny Authorization Vertical Slice

- **Status:** Implemented proof
- **Implemented:** 2026-07-10
- **MVP status:** Complete
- **Depends on:**
  [Actor, Execution Context, and Authorization](../specifications/actor-execution-context-authorization.md)

## Outcome

Authorization is now one Doxa runtime service rather than transport middleware:

```text
Feature permissionSources = [ApplicationPermissions]
Feature policies = [AccountPolicy, CounterPolicy]
  → compiler validates stable abilities, one optional source, and at most one policy per ability
  → manifest records source and policy graphs and dependencies
  → route entry authorizes before handler construction
  → Authorization is injectable in actions, queries, jobs, listeners, schedules, and services
  → bearer constraints may deny before source resolution
  → application permission source grants a base ability
  → optional policy evaluates current actor, tenant, context, and resource to narrow that grant
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

The Feature declares `policies = [CounterPolicy]`. An application may also select one
`PermissionSource`; the
[application permission source proof](application-permission-source-vertical-slice.md) covers its
authoring and composition. The compiler rejects duplicate policy ability owners, multiple sources,
invalid role classes, ambiguous IDs, invalid dependencies, and protected entries whose ability has
neither a selected policy nor a selected source catalog.

Every route explicitly declares either `static access = 'public'` or a stable ability. Public is a
visible opt-out; omission is a compilation failure. Protected routes authorize before their
constructor or handler runs.

## Decisions and denial

All decisions contain `effect`, a canonical manifest policy or permission-source ID, and a stable
code. An undeclared ability returns `doxa:default-deny / policy_missing`. `authorize()` throws a
normalized error for denial; `decide()` supports tests, diagnostics, and deliberate conditional
behavior.

Missing authentication becomes HTTP 401 without exposing policy detail. Other denial becomes a
stable HTTP 403. Internal decisions retain the precise policy and code.

## Bearer constraints

An access token's constraints are upper bounds, never grants. Exact ability, global `*`, and named
prefix wildcards are supported. If a constrained bearer lacks the requested ability, Doxa denies
through `doxa:credential-constraints` before a permission source or application policy can allow it.
Constraints remain in queue execution envelopes so asynchronous work cannot gain authority through
transport.

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

The current suite proves manifest ownership, every entry role, automatic HTTP entry authorization,
anonymous 401 behavior, structured allow and deny, resource ownership, missing-owner default denial,
bearer constraint denial, permission-source composition, durable audit metadata, testing fakes,
diagnostics, metrics, and concurrent execution isolation.

Durable delegation grants and policy-decision capture in journal/outbox metadata remain potential
post-MVP extensions; neither weakens the implemented default-deny entry and resource contract.

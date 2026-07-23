# 0035: Provide Read-Only Model Sessions During Authorization

- **Status:** Accepted
- **Accepted:** 2026-07-23
- **Scope:** Runtime authorization and model-query ergonomics
- **Amends:** [Eloquent-style model runtime](0012-eloquent-style-model-runtime.md),
  [typed model queries and relationships](0029-typed-model-queries-relationships.md), and
  [application permission sources](0034-application-permission-sources.md)
- **Decision owners:** Doxa maintainers

## Decision

Every runtime-invoked `PermissionSource.resolve()` and `Policy.decide()` will receive ambient access
to Doxa's declared model API through a read-only `ModelSession`. Authorization shares the owning
operation's persistence boundary when one exists and opens one bounded read transaction otherwise.

Authorization request objects remain unchanged. Application code loads current authorization facts
through declared models:

```ts
export class ApplicationPermissions extends PermissionSource {
  static override readonly id = 'application'
  static override readonly abilities = ['contact.read', 'user.update']

  async resolve(request: PermissionSourceRequest) {
    if (request.actor.kind !== 'user' || !request.actor.id) return []

    const user = await User.with(['permissions', 'group.permissions']).find(request.actor.id)
    if (!user) return []

    return mapPermissionsToAbilities(user.permissions, user.group.permissions)
  }
}
```

No model reader, transaction, storage mapping, entity-type string, or persisted-state representation
is added to `PermissionSourceRequest` or `PolicyRequest`. `TransactionManager`, `ModelStorage`, and
the low-level reader APIs remain supported infrastructure contracts, but they are not the ordinary
application authorization path.

## Session and transaction ownership

Authorization model access follows these rules:

1. An active read-only model session is reused.
2. Authorization invoked while an action or job has an active writable session receives a separate
   read-only `ModelSession` over the same Unit of Work. Its identity map is isolated from the
   writable handler session.
3. When the owning action or job transaction exists but its writable model session has not opened,
   authorization receives a read-only session over that Unit of Work.
4. A query opens its read transaction and read-only session before entry authorization. Entry
   permission loading, entry policy evaluation, resource policy evaluation, and the query handler
   therefore share one stable snapshot and identity map.
5. A route, command, standalone listener, signal handler, schedule authorization, WebSocket
   subscription, or direct `Authorization` call without an owning model session opens and closes one
   bounded `TransactionManager.read()` session when source or policy evaluation is required.
6. Nested authorization from a policy reuses the current authorization session. Recursive
   source-managed authorization from inside permission-source resolution remains an integrity
   failure.

Action and job entry authorization runs inside the owning transaction but before construction of the
writable handler session. A denial rolls back that transaction without constructing or invoking the
handler.

Credential-constraint denials and default-deny decisions do not evaluate application source or
policy code and therefore do not open a persistence transaction. An already cached source-only
decision likewise does not create another model session.

Every authorization-owned session closes after success, denial, failure, timeout, cancellation, or
concurrent evaluation. Authorization models are read-only: `create`, `save`, and `delete` fail
before observers or persistence. Loaded permission facts remain execution-local, are cached only as
the existing canonical ability set, and are never serialized or added to execution context.

## Model-query identity terminals

The ordinary query builder gains exact logical-identity convenience without changing the existing
static identity fast path:

```ts
await User.with('permissions').find(userId)
await User.where({ active: true }).findOrFail(userId)
```

`ModelQuery.find(id)` appends an `id = requestedId` constraint to the existing immutable plan,
preserves its constraints, ordering, offset, relationship constraints, and eager loads, forces a
one-row limit, and returns the hydrated instance or `undefined`.

`ModelQuery.findOrFail(id)` has the same plan semantics and throws `ModelNotFoundError` containing
the requested ID when no record matches. The terminals emit distinct `find` and `findOrFail`
diagnostics. Existing `Model.find(id)` and `Model.findOrFail(id)` continue to use their current
single-identity session fast path.

## Observability and failure behavior

Standalone authorization read transactions use the existing transaction observation and telemetry
contracts. Model-query observations remain nested beneath the permission source or policy that
issued them and contain logical plan metadata without query values or raw permission records.

Source loading and integrity failures remain fail-closed and privacy-safe. A missing application
record is an ordinary absence and grants no source-managed ability. Authorization does not expose a
writable model surface and does not convert persistence failures into empty grants.

## Why this is consistent with Doxa

Application permission facts are ordinary current application state. Requiring each source or policy
to inject `TransactionManager`, reconstruct `ModelStorage`, construct entity types, query raw
persisted state, and manually rehydrate relationships makes the supported low-level persistence API
the practical application API. That contradicts Doxa's Eloquent-style model contract and makes the
safe path harder to understand.

This decision preserves the manifesto boundaries:

- authorization remains default-deny and Doxa-owned;
- model access remains bounded by an admitted execution, transaction, and session;
- authorization cannot mutate application state;
- query authorization and query handling observe one coherent snapshot;
- action and job writes remain confined to the handler's writable identity map;
- application code remains independent of Drizzle and physical persistence representation; and
- permission results remain current execution-local facts rather than propagated authority.

## Alternatives considered

### Add a reader to authorization requests

Rejected. It would expose persistence plumbing in the public authorization contract, encourage raw
state parsing, and create a second application read vocabulary beside declared models.

### Let authorization reuse a writable handler session

Rejected. A source or policy could mutate state, dirty a handler identity, or trigger observers
before authorization had admitted the operation.

### Open an independent read transaction for every authorization check

Rejected. Query authorization could observe a different snapshot from its handler, action and job
authorization would not share the owning persistence boundary, and nested checks would multiply
transactions and identity maps.

### Keep low-level authorization hydration as the recommended pattern

Rejected as the ordinary path. The APIs remain supported for infrastructure integrations, but making
every application reproduce model storage and hydration rules undermines the accepted model runtime.

## Consequences

- Permission sources and policies use the same declared model API as other application roles.
- Query entry authorization moves inside the query read boundary.
- Action and job entry authorization moves inside their transaction while remaining isolated from
  the writable handler session.
- Protected non-operation roles may incur one bounded read transaction when application
  authorization code actually runs.
- Runtime integration needs a minimal internal current-session state signal from
  `@doxajs/core/runtime`; no model-session machinery is added to the application-facing core root.
- The manifest format and compiler contract do not change.

## Required implementation proof

1. A consumer-shaped user, group, permission, and pivot model graph resolves direct and group
   abilities with `User.with(...).find(actorId)` and no low-level persistence imports.
2. Query entry authorization and its handler share one read session and identity map.
3. Actions and jobs use one transaction, a read-only authorization session, and a separate writable
   handler identity map.
4. Source and policy model create, save, and delete attempts fail before persistence.
5. Direct authorization and protected non-operation entrypoints receive bounded read sessions.
6. Query resource authorization reuses the query session; action and job resource authorization
   cannot mutate handler models.
7. Nested policy authorization reuses the session and permission-source resolution remains cached
   once per admitted execution.
8. Missing records deny normally; source loading and integrity failures remain privacy-safe and fail
   closed.
9. Sessions close after every terminal outcome and remain isolated across concurrent decisions.
10. Both new query terminals prove found, missing, constrained, eager-loaded, stale-session, and
    distinct diagnostic behavior in PostgreSQL and memory tests.

## Revisit when

- Authorization needs an explicitly historical rather than current persistence snapshot.
- Multiple independent persistence boundaries must participate in one authorization decision.
- A demonstrated policy needs safe, audited side effects that cannot be expressed as admitted
  application work after authorization.

## References

- [Doxa principles](../principles.md)
- [Actor, Execution Context, and Authorization](../specifications/actor-execution-context-authorization.md)
- [Model Querying and Relationships](../specifications/model-querying-and-relationships.md)

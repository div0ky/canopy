# 0034: Accept Application-Supplied Permission Sources

- **Status:** Accepted
- **Accepted:** 2026-07-17
- **Amended:** 2026-07-23 by [Decision 0035](0035-read-only-model-sessions-during-authorization.md)
- **Scope:** MVP
- **Decision owners:** Doxa maintainers

## Decision

Doxa will support one optional, application-wide `PermissionSource` selected through a Feature. The
source translates application-owned permission facts into a statically declared set of stable Doxa
abilities. Doxa owns compilation, execution-scoped resolution, policy composition, auditing,
testing, and diagnostics; the application continues to own roles, groups, grants, storage, and
administration.

A source is a framework role:

```ts
export class ApplicationPermissions extends PermissionSource {
  static id = 'application'
  static abilities = ['contact.read', 'branch.override']

  private readonly access = this.inject(ApplicationAccess)

  async resolve(request: PermissionSourceRequest) {
    return await this.access.abilitiesFor(request.actor, request.tenant)
  }
}

export class AuthorizationFeature extends Feature {
  id = 'authorization'
  permissionSources = [ApplicationPermissions]
}
```

Exactly zero or one source may be selected across the application. Its declared ability catalog is
literal, stable, compiler-inspectable, and included in the generated manifest. Returned abilities
must be a subset of that catalog. Unknown application permission records grant nothing, and a source
that returns an undeclared ability is a runtime-integrity failure.

## Authorization composition

Authorization remains one Doxa-owned pipeline:

1. Credential constraints may deny an ability but never grant it.
2. When the selected permission source declares the ability, the source must grant it for the
   current actor and tenant.
3. An optional application `Policy` for the same ability may further narrow the decision using a
   loaded resource or other current application state.
4. The final structured decision is audited once through the existing authorization path.

A policy can never override a permission-source denial. If a source-managed ability has no explicit
policy, a source grant is the final allow decision. Abilities outside the source catalog retain the
existing policy-only behavior. A protected role must reference an ability declared by either the
selected permission source or exactly one selected policy.

The source is resolved lazily and its returned ability set is cached at most once per admitted
execution. Nested actions, queries, policies, listeners, and other synchronous work reuse that
result. A new HTTP request, command, WebSocket message, job, schedule firing, or queued listener
creates a new execution and resolves permissions again when a source-managed ability is checked.
Loaded permissions are never added to `ExecutionContext`, serialized into queue envelopes, or
propagated through telemetry baggage.

## Why now

Production-shaped adoption against an existing application demonstrated a repeated gap: application
code can already load legacy permission tables inside each policy, but doing so duplicates mapping,
caching, and failure behavior and makes the ordinary `static access = 'contact.read'` path depend on
feature-local plumbing. The framework has enough evidence to standardize the integration seam
without standardizing an RBAC schema.

This contract also preserves the distinction established by
[Decision 0022](0022-defer-first-party-permissions.md): Doxa accepts a source of permission facts
but does not prescribe how those facts are stored or managed.

## Boundary

- The source returns canonical ability names, not raw roles, groups, database rows, or credentials.
- Ability catalogs are exact strings; wildcards are reserved for credential constraints and are not
  permission grants.
- Doxa does not merge multiple sources or define precedence between application permission stores.
- Source failures fail closed as authorization infrastructure failures rather than silently becoming
  empty permissions or application-policy allows.
- Recursive authorization from inside source resolution is an integrity failure; sources load facts
  through ordinary services rather than source-protected Doxa dispatch.
- Permission-source results are execution-local facts, not durable authority snapshots.
- Resource ownership, branch scope, tenant-specific rules, and other domain constraints remain
  policies when they require more than possession of an ability.
- Runtime-invoked sources and policies receive ambient read-only access to declared models under
  [Decision 0035](0035-read-only-model-sessions-during-authorization.md). Their request objects stay
  persistence-neutral, and low-level persistence integrations remain compatible.

## Alternatives considered

### One global application policy

Rejected as the framework contract. It can reproduce the behavior in one application, but it turns
permission loading into boilerplate, makes resource-policy composition awkward, and hides the
distinction between base grants and domain-specific narrowing.

### Put permissions into `ExecutionContext`

Rejected. Execution context is immutable causal and identity metadata with controlled propagation.
Loaded permissions are current application facts and must be re-evaluated across asynchronous
boundaries.

### Ship Doxa-owned role and permission tables

Still deferred. Existing applications have incompatible schemas and semantics, and this integration
contract does not require Doxa to choose one.

### Allow multiple permission sources

Rejected for the initial contract. Merging grants, explicit denials, tenant scope, and source
failures would introduce consequential precedence rules without demonstrated need.

## Consequences

- Applications can use stable Doxa abilities directly across every entry role.
- Legacy group and user permissions are loaded at most once per execution through one inspectable
  seam.
- Policies remain available to narrow source grants for resources and domain state.
- The compiler and manifest gain one new framework role and ability owner.
- Runtime authorization gains a source-resolution phase before optional policy evaluation.
- Testing and diagnostics must distinguish credential denial, permission-source denial, policy
  denial, and authorization infrastructure failure.
- Applications must maintain an explicit mapping from legacy permissions to the declared Doxa
  ability catalog.

## Required implementation proof

1. The compiler accepts zero or one permission source and rejects multiple sources.
2. Source abilities are literal, stable, unique, and valid ability names.
3. Protected roles compile against the union of source-managed and policy-managed abilities.
4. A source denial cannot be widened by a policy.
5. A source grant without a policy allows; a resource policy can narrow a source grant.
6. Credential constraints deny before source resolution.
7. Resolution occurs once within an execution and again in the next execution.
8. Undeclared returned abilities and source failures fail closed.
9. Authorization audit, telemetry, testing, and diagnostics identify the final decision path without
   exposing raw permission facts.
10. Queue and other asynchronous admissions re-evaluate the source rather than propagating a prior
    permission snapshot.

## Revisit when

- Multiple independent permission stores require explicit grant and denial precedence.
- A production application requires temporal grants or delegation that cannot be represented by the
  actor, tenant, policy, and permission-source contracts.
- Common production schemas justify an optional first-party permission persistence package.

## References

- [Actor, Execution Context, and Authorization](../specifications/actor-execution-context-authorization.md)
- [Defer First-Party Roles and Permission Storage](0022-defer-first-party-permissions.md)
- [Path-Independent Services and Feature Sharing](0016-path-independent-structure-autowired-services.md)

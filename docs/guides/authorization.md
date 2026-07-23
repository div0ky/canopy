# Authorization and Application Permissions

Doxa authorizes every protected route, action, query, listener, job, schedule, signal handler, and
command through the same default-deny ability pipeline. Declare `static access = 'public'` only for
intentional public entry points. Otherwise declare a stable ability:

```ts
export class ContactDetails extends Query<void, Contact> {
  static id = 'contact-details'
  static override readonly access = 'contact.read'
}
```

## Map an existing permission model

Applications that already own groups, user permissions, or another authorization schema expose those
facts through one application-wide `PermissionSource`. The source maps application records to the
exact Doxa ability names declared in its static catalog:

```ts
export class ApplicationPermissions extends PermissionSource {
  static id = 'application'
  static abilities = ['contact.read', 'contact.update']

  async resolve(request: PermissionSourceRequest) {
    if (request.actor.kind !== 'user' || !request.actor.id) return []

    const user = await User.with(['permissions', 'group.permissions']).find(request.actor.id)
    if (!user) return []

    return mapPermissionsToAbilities(user.permissions, user.group.permissions)
  }
}

export class AuthorizationFeature extends Feature {
  id = 'authorization'
  permissionSources = [ApplicationPermissions]
}
```

Permission sources and policies use the ordinary declared model API. Doxa activates a read-only
model session before invoking them, so authorization code does not inject `TransactionManager`,
reconstruct `ModelStorage`, build entity-type strings, call `queryEntities`, or parse raw persisted
state. `PermissionSourceRequest` and `PolicyRequest` remain persistence-neutral.

An application may still place mapping behavior in an ordinary `ApplicationAccess` service or
repository. When another Feature owns that concrete service, export it intentionally:

```ts
export class CrmFeature extends Feature {
  id = 'crm'
  provides = [ApplicationAccess]
}
```

`provides` does not turn the service into a singleton. An `ExecutionScoped` service remains
execution-scoped; an unmarked ordinary service remains transient. A source is itself
execution-scoped and Doxa caches its resolved ability set at most once per admitted execution.

Load permission facts through declared models, ordinary services, or repositories. The low-level
`TransactionManager` and model-reader contracts remain supported for infrastructure integrations,
but they are not required for normal application authorization. A source must not dispatch
source-protected work or call `Authorization` while resolving; Doxa rejects recursive authorization
instead of allowing the source to await its own in-flight result.

Exactly zero or one source may be selected across the application. Its returned abilities must be a
subset of `static abilities`. Unknown application records should grant nothing. Returning an
undeclared ability or throwing while loading permissions fails authorization closed.

Praxis can create both declarations:

```sh
pnpm doxa make:service Crm/ApplicationAccess --provide
pnpm doxa make:permission-source Authorization/ApplicationPermissions \
  --abilities=contact.read,contact.update
```

## Add resource rules

A source answers whether the actor possesses a base ability. A `Policy` for the same ability may
narrow that grant using a resource or other current application state:

```ts
export class ContactPolicy extends Policy<{ ownerId: string }> {
  static id = 'contact'
  static abilities = ['contact.update']

  decide(request: PolicyRequest<{ ownerId: string }>) {
    return request.resource?.ownerId === request.actor.id
      ? allow('contact')
      : deny('contact', 'contact_owner_required')
  }
}
```

Policies receive the same read-only model access, including when they run before an operation
handler:

```ts
async decide(request: PolicyRequest<{ branchId: string }>) {
  const user = request.actor.id ? await User.with('branches').find(request.actor.id) : undefined
  return user?.branches.some((branch) => branch.id === request.resource?.branchId)
    ? allow('contact')
    : deny('contact', 'branch_required')
}
```

Model `create`, `save`, and `delete` calls from a permission source or policy fail before
persistence.

The decision order is fixed:

1. Bearer credential constraints may deny but never grant.
2. A source-managed ability must be present in the source result.
3. A policy for the same ability may further narrow the source grant.
4. Doxa records the final structured decision through authorization audit and telemetry.

A source denial cannot be widened by a policy. Abilities outside the source catalog retain
policy-only behavior.

## Execution and asynchronous boundaries

Permission results are execution-local application facts. Doxa does not add them to
`ExecutionContext`, HTTP state, trace baggage, journal context, or queue envelopes. Nested
synchronous work reuses the current result. Every new HTTP request, WebSocket message, command, job,
retry, schedule firing, or queued listener resolves the source again for its admitted actor and
tenant.

This is deliberately not HTTP middleware. The contract works identically for every Doxa entry role.

Query entry authorization runs inside the query's read transaction and shares its snapshot and
identity map with the query handler. Action and job entry authorization runs inside the owning
transaction through a separate read-only identity map before Doxa constructs the writable handler
session. Resource checks performed inside writable handlers receive another read-only view over the
same Unit of Work.

Routes, commands, standalone or queued listeners, signal handlers, schedules, private or presence
WebSocket subscriptions, and direct `Authorization` calls open one bounded read transaction when
source or policy evaluation needs model access. Credential constraints and default-deny decisions
remain transaction-free.

## Testing and inspection

`DoxaTestHarness.actingAsUser()` and the other acting-as helpers exercise the real source through
normal admission. Assert the final structured authorization decision: source grants and denials use
the compiled `permission-source:<feature>/<id>` identity, while policy narrowing uses the policy
identity.

Inspect the compiled contract with:

```sh
pnpm doxa permission-source:list
pnpm doxa permission-source:list --json
pnpm doxa policy:list
```

Gnosis exposes the same bounded source metadata through `list_permission_sources`. Neither tool
loads or displays raw group memberships or permission records.

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

`ApplicationAccess` remains ordinary application code. It may load legacy group and user
permissions, call an internal service, or implement another capability model. When another Feature
owns it, export the concrete service intentionally:

```ts
export class CrmFeature extends Feature {
  id = 'crm'
  provides = [ApplicationAccess]
}
```

`provides` does not turn the service into a singleton. An `ExecutionScoped` service remains
execution-scoped; an unmarked ordinary service remains transient. A source is itself
execution-scoped and Doxa caches its resolved ability set at most once per admitted execution.

Load permission facts through ordinary services or repositories. A source must not dispatch
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

# 0022: Defer First-Party Roles and Permission Storage

- **Status:** Deferred
- **Deferred:** 2026-07-10
- **Decision owners:** Doxa maintainers

## Decision

Doxa will not yet ship a first-party roles, memberships, grants, or permission-assignment data
model. The framework's actor, stable ability, default-deny policy, resource authorization, bearer
constraint, audit, manifest, diagnostic, and testing contracts remain core and implemented.

Applications may supply permission facts from their own database or services through the
application-wide `PermissionSource` accepted by
[Decision 0034](0034-application-permission-sources.md). Roles are application facts, not actor
kinds. A bearer-token constraint may only narrow authority and must never become a permission grant.

## Why defer it

Role-based access control is only one authorization strategy. Shipping tables prematurely would
force assumptions about tenants, organizations, role inheritance, explicit denial, temporal grants,
resource scope, and existing enterprise identity data. Those choices are difficult to reverse and
are not required for Doxa policies to authorize real applications today.

Existing-database mapping stabilized first, and Decision 0034 now defines the integration contract.
A later first-party permissions package must use that same contract for either Doxa-owned tables or
an existing application's role and membership schema.

## Current application experience

The permission source maps application-owned facts to the stable base abilities used everywhere:

```ts
export class ApplicationPermissions extends PermissionSource {
  static id = 'application'
  static abilities = ['orders.view', 'orders.update']

  private readonly access = this.inject(ApplicationAccess)

  async resolve(request: PermissionSourceRequest) {
    return await this.access.abilitiesFor(request.actor, request.tenant)
  }
}
```

`ApplicationAccess` is ordinary application code and may query legacy tables, call another service,
or implement a bespoke capability model. Optional policies continue to narrow a source grant for
resource ownership and domain state. Doxa compiles both ability owners, enforces default denial, and
audits the final decision. Doxa still does not own role, membership, grant, assignment, or
administration storage.

## Revisit when

- Tenant and delegation contracts are complete enough to constrain grant scope.
- At least two production-shaped applications demonstrate common role and membership needs.
- The package can remain optional without creating a second authorization system beside policies.

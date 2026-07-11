# 0022: Defer First-Party Roles and Permission Storage

- **Status:** Deferred
- **Deferred:** 2026-07-10
- **Decision owners:** Canopy maintainers

## Decision

Canopy will not yet ship a first-party roles, memberships, grants, or permission-assignment data
model. The framework's actor, stable ability, default-deny policy, resource authorization, bearer
constraint, audit, manifest, diagnostic, and testing contracts remain core and implemented.

Applications may supply permission facts to policies from their own database or services. Roles are
application facts, not actor kinds. A bearer-token constraint may only narrow authority and must
never become a permission grant.

## Why defer it

Role-based access control is only one authorization strategy. Shipping tables prematurely would
force assumptions about tenants, organizations, role inheritance, explicit denial, temporal grants,
resource scope, and existing enterprise identity data. Those choices are difficult to reverse and
are not required for Canopy policies to authorize real applications today.

Existing-database mapping should stabilize first. A later first-party permissions package must be
able to use either Canopy-owned tables or an existing application's role and membership schema
through one permission-source contract.

## Current application experience

Policies remain the single decision point:

```ts
export class OrderPolicy extends Policy<Order> {
  static abilities = ['orders.view', 'orders.update']

  private readonly access = this.inject(ApplicationAccess)

  async decide(request: PolicyRequest<Order>) {
    if (!(await this.access.has(request.actor, request.ability, request.tenant))) {
      return deny('order', 'permission_required')
    }
    return request.resource && request.resource.ownerId !== request.actor.id
      ? deny('order', 'ownership_required')
      : allow('order')
  }
}
```

`ApplicationAccess` is ordinary application code and may query legacy tables, call another service,
or implement a bespoke capability model. Canopy continues to compile the ability owner, enforce
default denial, and audit the final policy decision.

## Revisit when

- Existing-table model and auth mapping are implemented and proven.
- Tenant and delegation contracts are complete enough to constrain grant scope.
- At least two production-shaped applications demonstrate common role and membership needs.
- The package can remain optional without creating a second authorization system beside policies.

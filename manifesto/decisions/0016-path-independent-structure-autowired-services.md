# 0016: Keep Source Layout Path-Independent and Autowire Ordinary Services

- **Status:** Accepted
- **Accepted:** 2026-07-10
- **Scope:** MVP
- **Decision owners:** Canopy maintainers

## Decision

Canopy imposes no semantic folder structure. Feature declarations explicitly own framework-facing
classes, while ordinary concrete services and helpers are discovered through constructor
reachability. Developers may reorganize source files and domain folders without framework
configuration or behavioral changes.

This direction is summarized as:

> Folder paths organize humans. Imports and Feature declarations organize Canopy.

The compiler records source locations for provenance and diagnostics, but a path must never activate
a class, determine its framework role, change its identity, select its scope, or alter its runtime
behavior.

## Organizational freedom

Laravel-style role folders, domain-first folders, vertical slices, and workspace packages are all
valid Canopy layouts:

```text
src/events/orders/order-shipped.ts
src/jobs/billing/process-refund.ts
```

```text
src/features/orders/events/order-shipped.ts
src/features/billing/jobs/process-refund.ts
```

```text
packages/orders/src/events/order-shipped.ts
packages/billing/src/jobs/process-refund.ts
```

The owning Feature imports and declares the framework-facing class. Moving the class updates its
TypeScript import but does not change its stable manifest ID, Feature ownership, listeners, journal
identity, queue identity, dependency scope, or runtime semantics.

Canopy starters and generators may provide an opinionated layout, but that layout is a placement
default rather than a discovery contract. Large applications may introduce domain folders or deepen
a Feature into internal business areas without declaring nested framework modules.

## File conventions

Canopy's generated and documented defaults are:

- Kebab-case filenames, such as `calculate-order-total.ts`.
- PascalCase classes, such as `CalculateOrderTotal`.
- One primary framework-facing class per file.
- No required barrel files.
- Colocated unit tests named `*.test.ts`.
- Feature and integration tests may live under `tests/`.

These conventions improve predictability for developers, generators, source diagnostics, and
Cultivate. They do not become runtime semantics. Applications may deviate where TypeScript imports
and the manifest remain unambiguous.

## Framework-facing classes

Feature role arrays remain the sole ownership declarations for models, actions, queries, routes,
policies, events, listeners, observers, jobs, schedules, commands, and other framework entry points.

The compiler must inspect the TypeScript program for exported Canopy role classes that do not belong
to any selected Feature. It should report an unowned declaration with source-aware fixes, but it
must not silently register or classify the class based on its path.

## Ordinary services

A focused business service is normally an ordinary class:

```ts
export class PricingService {
  constructor(
    private readonly discounts: DiscountEngine,
    private readonly taxes: TaxCalculator,
  ) {}

  async quote(input: PlaceOrderInput): Promise<Quote> {
    // ...
  }
}
```

When a declared Action, Query, Listener, Job, Route, or other role injects a concrete class through
`this.inject()`, Canopy recursively follows and autowires that service's constructor dependencies.
Concrete services do not require a Canopy base class, decorator, Feature role array, provider entry,
or service registration.

Abstract ports, aliases, primitive values, factories, and non-default scopes remain explicit Feature
bindings because the compiler cannot or should not infer application intent.

## Separation of concerns

Canopy encourages the following division without requiring a directory for each term:

- Model methods own behavior and invariants belonging to one entity.
- Value objects and functions express pure calculations without dependencies.
- Domain services express business rules spanning multiple entities or concepts.
- Application services provide reusable orchestration beneath use cases.
- Actions own externally meaningful use cases and transaction boundaries.
- Ports describe abstract capabilities needed by application or domain code.
- Adapters implement ports using infrastructure.
- Features own framework-facing behavior and intentional cross-domain capabilities.

OOP is the primary programming model, not a requirement to turn every small pure transformation into
a container-managed class. Large Actions and Models should be decomposed into intention- revealing
collaborators without moving domain invariants into arbitrary utility code.

## Feature privacy and sharing

The concrete dependency closure beneath a Feature is private to that Feature by default. Canopy must
reject an accidental concrete dependency from one Feature into another and must reject a concrete
service with ambiguous ownership across multiple Features.

Intentional sharing requires one of the following:

- Expose the concrete service directly through the owning Feature's `provides` declaration.
- Expose an abstract port or typed token when polymorphism or isolation is actually required.
- Promote the behavior into a dedicated Feature.
- Extract framework-independent code into a library package.
- Keep small domain concepts separate when sharing would create harmful coupling.

Canopy must not silently create a global service namespace or a `shared/services` dumping ground.

## Service providers and lifecycle

Ordinary application services do not need a Laravel-style runtime `ServiceProvider.register()` step.
Feature bindings declare abstract composition, constructor analysis discovers concrete services, and
the generated manifest fixes the dependency graph before boot.

Resources that own startup, shutdown, connection, or process lifecycle are not ordinary helper
services. They require explicit provider or adapter declarations so lifecycle, scope, health, and
disposal remain inspectable.

## Testing

A focused service must be directly constructible with ordinary fakes or test doubles. Unit tests
must not boot or reconstruct the application container merely to exercise isolated business logic.

Application-level tests may replace ports or concrete dependencies through first-party, test-scoped
Canopy overrides. Overrides must preserve scope validation and remain isolated between concurrent
test applications.

## Consequences

- Applications can grow from a small tree into domain folders or packages without framework
  migration work.
- Feature files remain explicit tables of contents while internal business decomposition stays
  inexpensive.
- Concrete autowiring removes provider boilerplate but requires excellent cycle, ownership, and
  scope diagnostics.
- Source moves preserve application identity because stable IDs, not paths, define manifest
  capabilities.
- Cross-feature collaboration becomes intentional instead of emerging from a global container.

## Required implementation proof

The MVP must prove:

1. Identical application behavior from role-first, domain-first, feature-first, and package-based
   source layouts without Canopy configuration changes.
2. Moving a declared class changes source provenance but not manifest identity or runtime behavior.
3. An undeclared Canopy role class produces a source-aware diagnostic and is never silently
   activated.
4. A multi-level concrete service graph is autowired without Feature or provider registration.
5. Missing bindings, cycles, invalid scopes, ambiguous ownership, and accidental cross-feature
   concrete dependencies fail before boot.
6. Abstract bindings and intentional cross-feature capabilities resolve predictably.
7. A focused service can be unit tested through direct construction without a Canopy application.
8. Test-scoped dependency overrides remain isolated and retain container semantics.
9. Generators update direct imports and Feature role arrays without requiring barrel files.

The
[pg-boss queue and worker vertical slice](../implementation/pg-boss-queue-worker-vertical-slice.md#application-organization)
reorganizes the integrated application from one flat directory into infrastructure, counters, and
system domains with role folders. All behavior remains green without folder configuration, while
manifest ownership changes only through the new Feature declarations and imports.

## Revisit when

- Path-independent ownership prevents the compiler from producing reliable source diagnostics.
- Constructor reachability cannot identify a deterministic Feature-private dependency closure.
- Enterprise applications demonstrate that the Feature boundary is too coarse for safe internal
  modularization.
- Generator edits cannot preserve freely organized source trees without surprising developers.

## References

- [Canopy manifesto](../index.md#object-oriented-by-conviction)
- [Canopy architecture](../architecture.md#application-services-and-internal-modules)
- [Explicit Feature declarations](0014-explicit-features-generated-manifest.md)
- [Class-first container](0011-class-first-oop-container.md)
- [First-party CLI and generators](0004-first-party-cli-generators.md)
- [Laravel directory structure](https://laravel.com/docs/13.x/structure)
- [Laravel service container](https://laravel.com/docs/13.x/container)

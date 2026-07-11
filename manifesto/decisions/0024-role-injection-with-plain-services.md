# 0024: Use Role-Scoped Injection and Plain Constructor-Injected Services

- **Status:** Accepted
- **Accepted:** 2026-07-11
- **Scope:** MVP
- **Decision owners:** Doxa maintainers

## Decision

Framework-facing application classes extend their corresponding Doxa role and receive dependencies
from the active execution scope through the inherited `this.inject()` API. Ordinary application
services remain plain classes and use constructor injection.

Application code does not manually call `super()` during normal framework authoring. A developer
only writes `super()` when deliberately implementing an exceptional custom constructor on a role
class.

The canonical shape is:

```ts
export class ListOrdersRoute extends Route {
  private readonly orders = this.inject(OrderService)

  handle() {
    this.logger.info('Listing orders')
    return this.orders.all()
  }
}
```

```ts
export class OrderService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly pricing: PricingService,
  ) {}
}
```

## Framework roles

Routes, actions, queries, jobs, schedules, events, listeners, observers, policies, commands,
signals, and other framework entry points extend one Doxa role class. This inheritance is meaningful
rather than ceremonial: it supplies the role contract, scoped injection, the class-bound logger,
execution-context access, and role-specific framework behavior.

`this.inject(Dependency)` is:

- Typed by the requested concrete class, abstract-class port, or Doxa token.
- Resolved from the role instance's admitted execution scope.
- Recorded as an explicit dependency edge in the generated manifest.
- Validated before boot for missing bindings, cycles, ownership, and scope violations.
- Fail-closed when a required dependency cannot be resolved.

It is not an unrestricted runtime service locator. The compiler must be able to identify every
injection identity statically; dynamic tokens and conditional dependency lookup are rejected.
Optional dependencies use the separately accepted explicit optional-dependency declaration and
remain visible in the manifest.

Every framework role also receives `this.logger`, already bound to its stable role identity and
current execution context. Application code does not inject `Logger` merely to obtain an ordinary
class channel.

## Ordinary services

Ordinary services and helpers do not extend a Doxa base class and do not receive `this.inject()`.
They use constructor injection, remain recursively discoverable through the generated dependency
graph, and can be directly instantiated in focused unit tests.

This boundary prevents domain and application services from depending on ambient container state
while letting framework entry points use the execution scope they already represent.

## Constructors and payloads

Generators and documentation must not add empty constructors or routine `super()` calls.
Framework-role inputs and dispatch payloads should use the role's typed input API so jobs, events,
signals, actions, and queries do not need constructors merely to carry application data.

A custom constructor remains available for a genuinely exceptional role implementation. Because Doxa
uses native JavaScript inheritance, that constructor must call `super()`; the exception is
intentional and should be obvious in review.

## Consequences

- Every framework-facing class follows one visible inheritance rule.
- Normal role authoring has no constructor or `super()` ceremony.
- Scoped dependencies and logging feel built in while remaining compiler-inspectable.
- Ordinary business services retain conventional OOP construction and simple unit testing.
- Doxa must implement and statically analyze role field injection without falling back to reflection
  or hidden process-global state.
- Existing generated examples and framework documentation that constructor-inject role classes must
  migrate to `this.inject()`.

## Required implementation proof

The MVP must prove:

1. Every supported role can resolve concrete services, abstract ports, and typed tokens through
   `this.inject()` without declaring a constructor.
2. Injected dependencies use the current request, job, command, schedule, listener, or signal
   execution scope with identical scope semantics.
3. The generated JSON manifest exposes every injection edge without executing application code.
4. Missing, cyclic, cross-feature, ambiguous, and scope-invalid dependencies fail static
   compilation.
5. `this.logger` is automatically class-bound and execution-scoped on every framework role.
6. Ordinary services remain constructor-injected, autowired, and directly unit-testable.
7. Generated application code contains no routine `super()` calls.
8. Multiple applications and concurrent tests cannot leak injected instances or logger context.

## References

- [Class-first OOP container](0011-class-first-oop-container.md)
- [Path-independent structure and autowired services](0016-path-independent-structure-autowired-services.md)
- [Explicit Features and generated manifest](0014-explicit-features-generated-manifest.md)
- [Doxa manifesto](../index.md#object-oriented-by-conviction)

# 0009: Adopt the Initial Operation and Lifecycle Defaults

- **Status:** Accepted
- **Accepted:** 2026-07-10
- **Decision owners:** Canopy maintainers

## Decision

The MVP specifications will use these defaults:

- Each action or query has exactly one handler.
- Actions open a Canopy unit of work and database transaction by default.
- Queries are non-mutating and do not publish domain events.
- Nested action dispatch is prohibited in the MVP.
- Domain events are collected during action execution.
- Entity-state writes, journal entries, and outbox records are persisted before commit and commit
  atomically.
- After-commit listeners cannot execute before durability is established.
- Partial application startup unwinds and disposes everything that started successfully.

These are framework semantics, not conventions implemented independently by each transport or
adapter.

## Initial authoring contract

The initial implementation gives each operation one class. Framework roles receive scoped
dependencies through `this.inject()`, while invocation input belongs to the intention-revealing
`handle(input)` method:

```ts
export class CreateOrder extends Action<CreateOrderInput, Order> {
  static id = 'create-order'

  private readonly orders = this.inject(OrderService)

  handle(input: CreateOrderInput): Promise<Order> {
    return this.orders.create(input)
  }
}
```

Features declare `actions` and `queries` through the accepted role arrays. Callers inject
`ActionBus` or `QueryBus` and dispatch the declared class plus its typed input:

```ts
await actions.execute(CreateOrder, input)
```

This keeps the Feature declaration concise, removes routine constructor and `super()` ceremony,
makes one handler obvious to humans and Cultivate, and avoids separate command and handler
registration. The compiler records the exact operation, dependency graph, scope, and transaction
semantics in the manifest. Ordinary services beneath the operation continue to use constructor
injection.

## Consequences

- Transaction and event behavior remains predictable across HTTP, console, schedule, and job entry
  points.
- Follow-up operations use domain events, after-commit listeners, or explicit orchestration rather
  than recursively dispatching actions inside actions.
- Queries cannot hide mutations or durable side effects.
- Lifecycle implementations must track successfully started resources and dispose them in reverse
  dependency order after startup failure.

## Remaining specification work

The action, query, unit-of-work, event, observer, and application-lifecycle specifications must
still define exact phases, cancellation, deadlines, isolation, retries, and error normalization.
Those details may refine these defaults but must not contradict them silently.

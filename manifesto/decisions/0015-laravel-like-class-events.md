# 0015: Provide Laravel-Like Class Events Throughout the Application

- **Status:** Accepted
- **Accepted:** 2026-07-10
- **Scope:** MVP
- **Decision owners:** Canopy maintainers

## Decision

Canopy will provide a Laravel-like, class-first event experience. An event is a named data-bearing
class that may be dispatched from ordinary application code anywhere a Canopy application is
running. Listener classes declare the event they consume through their typed `handle` method,
receive scoped dependencies through `this.inject()`, and opt into queued or after-commit execution
through the accepted capability interfaces.

The Canopy compiler will turn event, listener, dispatch, transaction, queue, and observability
relationships into explicit manifest facts. The runtime does not discover listeners through
reflection or a second event registry.

## Event authoring and dispatch

The intended MVP experience is:

```ts
export class OrderShipped extends Event<{ orderId: string }> {
  static id = 'order-shipped'
}

await OrderShipped.dispatch({ orderId: order.id })
```

`dispatch()` is inherited framework behavior. It creates the event with the supplied typed payload
and routes it through the active Canopy application and execution context. Developers do not need to
inject a dispatcher merely to raise a named event from an action, model method, listener, job,
schedule, controller, command, or other framework-managed entry point.

Static event dispatch is a narrow framework capability backed by the current execution context, not
a general service locator. Code running outside a Canopy-managed execution must enter an application
scope or use the application runtime's event dispatcher explicitly. Canopy must not use one
process-global dispatcher that makes multiple applications or tests interfere.

## Listener authoring

Listeners are framework role classes with scoped injection:

```ts
export class SendShipmentNotification extends Listener implements ShouldQueue {
  private readonly mail = this.inject(Mailer)

  async handle(event: OrderShipped): Promise<void> {
    await this.mail.sendShipmentNotice(event.payload.orderId)
  }
}
```

The compiler associates the listener with `OrderShipped` from the `handle` parameter type and
records the relationship in the manifest. The Feature remains the explicit table of contents:

```ts
export class OrdersFeature extends Feature {
  id = 'orders'
  events = [OrderShipped]
  listeners = [SendShipmentNotification]
}
```

Generators must create the class, add it to the owning Feature, and produce the correct typed
handler as one operation. Source inspection may diagnose an undeclared event or listener but must
not silently activate it.

## Execution capabilities

Laravel-aligned capability semantics apply:

- A listener runs locally by default.
- `ShouldQueue` makes the listener asynchronous queue work.
- `ShouldQueueAfterCommit` requires queued dispatch to wait for the active transaction to commit.
- `ShouldDispatchAfterCommit` on an event delays dispatch until the active transaction commits and
  discards the event if the transaction rolls back.
- `ShouldBroadcast` requests queued broadcasting.
- `ShouldBroadcastNow` requests synchronous broadcasting in the current process.

In an active Canopy Unit of Work, ordinary queued listeners and broadcasts are outbox-backed and
become eligible after commit by default. This makes the safe behavior automatic while preserving the
explicit capability vocabulary.

Local listener failures propagate through the current dispatch unless a later specification defines
an explicit rescue capability. Queued listener failures use Canopy's job retry, idempotency,
timeout, and terminal-failure semantics.

## Events, domain events, and signals

`Event` is the general Laravel-like application event. It may be dispatched in any framework-managed
execution and is not automatically a durable domain fact.

`DomainEvent` is a specialization of `Event` for a fact produced by an accepted domain mutation. It
participates in the active Unit of Work and is journaled with entity, actor, initiator, correlation,
causation, and trace metadata. Dispatching a `DomainEvent` without the required mutation and Unit of
Work context must fail explicitly rather than silently losing durability.

`Signal` remains immediate framework coordination. Signals do not enter the domain journal or
pretend to provide durable delivery. This distinction preserves the MVP's separate event, signal,
listener, observer, journal, and outbox semantics without burdening ordinary event dispatch.

## Serialization

An event used by queued listeners, broadcasting, or durable recording must have a versioned,
serializable payload represented in the manifest. Canopy models in event payloads receive
first-party identity serialization and execution-scope rehydration analogous to Laravel's model
serialization. A queued listener may therefore observe current model state when it runs; an event
that requires an immutable historical value must carry that value explicitly.

Provider, database-engine, queue-engine, and transport types must not appear in event payloads.

## Testing experience

The first-party test application must support Laravel-like event fakes and assertions, scoped to the
test application:

```ts
events.fake([OrderShipped])

await shipOrder()

events.assertDispatched(OrderShipped)
events.assertDispatched(OrderShipped, (event) => event.order.id === order.id)
events.assertNotDispatched(OrderFailedToShip)
events.assertListening(OrderShipped, SendShipmentNotification)
```

Tests must also be able to fake all events, fake all except selected events, and scope a fake to a
callback. Faking prevents listener execution but preserves dispatch records and causal metadata for
assertions.

## Diagnostics and inspection

Canopy must provide an `event:list`-equivalent inspection command showing:

- Event ID, owner, source, and payload schema.
- Local, after-commit, queued, and broadcast listeners.
- Queue, retry, timeout, uniqueness, and serialization policy.
- Journal and outbox participation.
- Actor and causal propagation.

## Deferred or rejected for the MVP

- String-named and wildcard events are not part of the primary typed API.
- Runtime listener registration and boot-time directory scanning are rejected.
- Closure listeners and multi-method event subscriber classes may be reconsidered after the
  class-listener model is complete.
- Broadcasting transport implementation remains post-MVP even though its class semantics are
  reserved now.

## Required implementation proof

The MVP must prove:

1. A declared event can be dispatched from actions, models, listeners, jobs, schedules, controllers,
   and commands through the same static API.
2. Listener association is inferred from the typed `handle` parameter and validated at build time.
3. Constructor injection, execution context, actor, and causation behave identically for local and
   queued listeners.
4. Local, after-commit, queued, rollback, retry, and terminal-failure behavior matches the manifest.
5. Domain events, general events, and signals retain distinct durability semantics.
6. Model references and versioned payloads serialize and rehydrate predictably.
7. Event fakes and assertions are isolated between concurrently running test applications.
8. Event inspection reports the exact listeners and phases used by runtime dispatch.

The [class events vertical slice](../implementation/class-events-vertical-slice.md) implements the
first executable proof of inherited static dispatch, typed listener inference, constructor
injection, runtime isolation, local failure propagation, and transaction-aware after-commit
delivery. Queued delivery, domain events, signals, serialization, event fakes, inspection, and
entry-point parity remain required before the complete MVP contract is satisfied.

## References

- [Laravel events](https://laravel.com/docs/13.x/events)
- [Canopy MVP viability bar](../mvp.md#required-reactive-model)
- [Canopy architecture](../architecture.md#durable-side-effects)
- [Class roles and capabilities](0011-class-first-oop-container.md#role-classes-and-capability-traits)
- [Explicit Feature declarations](0014-explicit-features-generated-manifest.md)

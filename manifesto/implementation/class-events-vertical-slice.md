# Class Events Vertical Slice

- **Status:** Implemented proof
- **Implemented:** 2026-07-10
- **MVP status:** Incomplete
- **Depends on:** [Eloquent-style model vertical slice](eloquent-model-vertical-slice.md)

## Outcome

The fifth Canopy implementation proves Laravel-like class events across the active execution and
transaction boundary:

```text
await CounterIncremented.dispatch(counterId, amount, value)
  → execution-local Canopy event dispatcher
  → declared event manifest identity
  → typed listener association
  → constructor-injected local listeners
  → optional after-commit registration in the active Unit of Work
  → rollback discard or post-durability execution
```

The application does not inject an event dispatcher. `dispatch()` is inherited behavior available
inside a Canopy-managed execution and is scoped to that runtime, so concurrently booted
applications cannot share a process-global event registry accidentally.

## Authoring experience

Events are ordinary data-bearing classes:

```ts
export class CounterSaved extends Event implements ShouldDispatchAfterCommit {
  static id = 'counter-saved'

  constructor(
    readonly counterId: string,
    readonly value: number,
  ) {
    super()
  }
}
```

Listeners state the event they consume through the type of `handle(event)`:

```ts
export class RecordCounterSaved extends Listener<CounterSaved> {
  static id = 'record-counter-saved'

  constructor(private readonly recorder: EventRecorder) {
    super()
  }

  handle(event: CounterSaved): void {
    this.recorder.record(event)
  }
}
```

The Feature remains the explicit table of contents:

```ts
events = [CounterIncremented, CounterSaved]
listeners = [RecordCounterIncremented, RecordCounterSaved]
```

## Compilation and manifest

The compiler verifies that:

- Events are concrete `Event` subclasses with stable local IDs.
- Listeners are concrete `Listener` subclasses with stable local IDs.
- Every listener defines exactly one typed `handle(event)` parameter.
- The parameter names an event declared by a selected Feature.
- Role classes are not injected as ordinary dependencies.
- Listener constructors resolve through normal Canopy dependency rules.
- Conflicting local and queued after-commit capabilities fail compilation.

The generated manifest records stable event and listener identities, ownership, sources,
dependencies, inferred event relationships, and delivery phases. The constructor registry contains
the exact event and listener classes. Runtime directory scanning and reflection are unnecessary.
These required graph sections advance the fail-closed artifact contract to manifest format v2.

## Delivery semantics proved

Local listeners run immediately and sequentially in the current execution. Their constructor
dependencies, actor, correlation, and execution context are the same ones available to the code
that dispatched the event. A local listener failure propagates to the caller and rolls back an
active action transaction.

`ShouldHandleEventsAfterCommit` delays one local listener when a Unit of Work is active. Without an
active transaction it runs immediately.

`ShouldDispatchAfterCommit` delays the entire event when a Unit of Work is active. Its listeners
run only after PostgreSQL confirms commit. On rollback the event is discarded. Without an active
transaction it dispatches immediately, matching Laravel's semantics.

After-commit callbacks retain the admitted execution and its injectable services, but the action's
closed `ModelSession` and Unit of Work are not reused. A first-party model/read session for
post-commit listeners remains part of the complete listener execution specification.

The proof dispatches events from model behavior inside an action and directly from an HTTP route.
Dispatch outside a managed execution fails with `EventDispatchError` rather than resolving a
hidden global application.

## Executable evidence

The complete suite contains thirty-three passing tests. Event-specific conformance proves:

1. Events and listeners compile into stable, source-aware manifest relationships.
2. Listener constructor injection and `CurrentExecution` access work normally.
3. A model dispatches an event through the inherited static API.
4. Local listeners run before commit and propagate failures.
5. Listener-level and event-level after-commit behavior runs after successful durability.
6. Rollback discards all registered after-commit event work.
7. Actor and correlation context survive local and after-commit delivery.
8. An HTTP route dispatches through the identical static event API.
9. Dispatch outside a Canopy execution fails explicitly.

## Deliberate boundary

This is the synchronous and local-after-commit event slice, not the complete MVP reactive model.
Still required:

- `DomainEvent` journal semantics distinct from general `Event`.
- Immediate framework `Signal` semantics.
- Versioned queued payload schemas and model-reference serialization beyond the initial
  JSON event envelope.
- Model-reference serialization and rehydration for queued payloads.
- Event fakes and application-isolated assertions.
- Event inspection tooling and finalized listener ordering policy.
- Equivalent proof from jobs, schedules, console commands, and queued listeners.
- Broadcasting implementations for `ShouldBroadcast` and `ShouldBroadcastNow`.

Queued listener delivery is now implemented by the
[pg-boss queue and worker vertical slice](pg-boss-queue-worker-vertical-slice.md). Event fakes,
versioned payload schemas, model-reference rehydration, and complete entry-point parity remain
future work.

## Next slice

Completed alongside this work: [Hono HTTP vertical slice](hono-http-vertical-slice.md).

Completed later: [pg-boss queue and worker vertical slice](pg-boss-queue-worker-vertical-slice.md).

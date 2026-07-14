# Signals and Model Observers Vertical Slice

- **Status:** Implemented proof
- **Manifest format:** 8
- **Completed:** 2026-07-10

Doxa now compiles signals, signal handlers, and model observers from explicit Feature declarations
into the semantic manifest and constructor registry. Folder names have no runtime meaning.

Signals are immediate, in-process, sequential, and fail-fast. `Signal.dispatch()` requires an
admitted Doxa execution, preserves its actor and causal context, and never implies queueing,
journaling, deferral, or rollback. Signal handlers may be authorized through the same default-deny
ability system as other entry roles.

Observers provide the accepted Eloquent-style phases:

```text
retrieved
saving -> creating | updating -> persistence write -> created | updated -> saved
committed
```

All phases except `committed` execute inside the action transaction. `committed` is registered on
the Unit of Work and runs only after PostgreSQL confirms durability. A rollback therefore preserves
the already-observed in-process phases but suppresses `committed`. Observer exceptions before commit
fail the action and roll back its durable work. Remote side effects still belong in outbox-backed
queued listeners, not observers.

The reference application proves declaration, type-inferred signal/model association, generated
metadata, execution-context propagation, create/update ordering, and rollback behavior.

Later testing, query, worker, scheduling, and Praxis slices complete first-party assertions,
fake-persistence conformance, and operation-boundary entrypoint parity. Bulk mutation remains
explicitly unavailable pending its own accepted lifecycle contract.

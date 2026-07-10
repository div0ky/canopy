# Persistence and events

## Snapshot plus journal, not event sourcing

The current model snapshot is the source of truth. The journal records an append-only history of
domain decisions and mutations for audit, diagnosis, lineage, and future projections.

Canopy does not rebuild model state by replaying the journal. Events are not required to contain
every implementation detail necessary for replay. Changing a projection does not redefine the
authoritative business state.

This distinction keeps normal reads straightforward while preserving a trustworthy history.

## The unit of work

The unit of work coordinates one durable business transition:

1. Establish or reuse the active transaction.
2. Run applicable before-persistence lifecycle hooks.
3. Persist snapshot changes with optimistic concurrency.
4. Run applicable in-transaction after-persistence hooks.
5. Append audit events.
6. Append queueable deliveries to the outbox.
7. Commit.
8. Mark models persisted and clear collected events.
9. Run committed hooks and deferred after-commit work.

Snapshot, journal, and outbox writes are atomic. Network effects are not part of the database
transaction.

## Persistence adapters

A persistence adapter maps a domain model to a concrete store. It is responsible for:

- Loading a snapshot and hydrating the model
- Mapping changed attributes to persistence data
- Creating, updating, deleting, or restoring the snapshot
- Enforcing the model's concurrency strategy
- Participating in the active transaction

Canopy does not mandate one identifier type, table shape, soft-delete convention, or concurrency
column. Existing systems may use integer versions, timestamps, opaque tokens, or domain-specific
strategies. The adapter makes that difference explicit.

Prisma belongs in these adapters and in optimized read implementations—not in models or action
handlers.

## Optimistic concurrency

A save includes the expected persisted concurrency token. If the stored snapshot no longer
matches, the adapter throws an optimistic-lock error rather than overwriting another decision.

The caller may report the conflict, retry from a fresh snapshot when the action is safe to repeat,
or delegate to an explicit conflict-resolution workflow. Canopy does not silently merge business
state.

## Event identity and lineage

Persisted events have:

- Stable event ID
- Event name and schema version
- Aggregate type and ID
- Aggregate sequence/version
- Validated payload
- Occurrence and recording timestamps
- Actor metadata
- Correlation, causation, and trace identifiers

Multiple events from one model save require deterministic ordering and distinct aggregate sequence
numbers. Correlation groups work from the same execution; causation links a result to the event or
job that triggered it.

## Event delivery classes

### Audit only

The fact is persisted in the journal. No listener is implied. Use this for durable domain history
that has no independent side effect.

### In-transaction domain work

Runs before commit and may affect persisted state. It must be deterministic, fast, and free of
network I/O. Prefer direct domain behavior when the relationship is not genuinely decoupled.

### After commit

Runs in the originating process only after the transaction succeeds. Suitable for best-effort
local work such as in-memory invalidation or metrics where durable retry is unnecessary.

### Queued through the outbox

The transaction writes a delivery record. A worker claims and publishes it after commit. Use this
for notifications, broadcasts, vendor calls, search indexing, expensive projections, and any
effect that must survive process failure.

### Integration input

Webhooks, CDC messages, and vendor callbacks enter through infrastructure adapters. They may
produce actions or integration signals, but they must not forge domain intent or fabricate audit
events for decisions the application did not make.

## Transactional outbox

The outbox closes the failure window between committing domain state and enqueueing asynchronous
work.

Required behavior:

- Claim with row locks and `SKIP LOCKED`
- Lease claimed work so crashed workers do not strand it
- Retry with bounded exponential backoff
- Move exhausted entries to a dead state
- Derive queue job IDs from outbox IDs for deduplication
- Expose list, inspect, retry, and replay operations
- Preserve payload and event schema versions

Delivery is at least once. Handlers must therefore be idempotent or enforce idempotency at the
destination.

## Existing schemas

Canopy's example Prisma schema demonstrates the required infrastructure but is not a domain schema
template that existing applications must adopt. A conversion should normally:

- Keep current business tables and IDs
- Adapt Canopy to the existing generated client
- Reuse a compatible audit journal
- Add only missing framework infrastructure such as an outbox or failed-job table
- Preserve public contracts and historical records

Framework adoption should not be used as cover for an unrelated product-data redesign.

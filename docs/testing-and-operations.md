# Testing and operations

## Test pyramid

Canopy expects several complementary test levels.

### Domain unit tests

Construct models directly and verify invariants, state transitions, dirty attributes, and emitted
events. No Nest container or database should be required.

### Handler and policy tests

Use testing fakes for stores, execution context, jobs, cache, storage, notifications, broadcasts,
logging, and time. Verify intent orchestration and authorization without production adapters.

### Registry and lifecycle tests

Verify handler uniqueness, missing-handler failures, observer ordering, event listener selection,
schedule uniqueness, and context isolation.

### Contract tests

Parse representative client and server payloads through the same Zod contracts. These tests
protect compatibility independently from controller implementation.

### PostgreSQL integration tests

Use real PostgreSQL to prove:

- Snapshot, journal, and outbox atomicity
- Rollback behavior
- Optimistic concurrency
- Aggregate event ordering
- Outbox claiming and lease recovery
- Relevant raw SQL and migration assumptions

### Redis and BullMQ integration tests

Use real Redis to prove retries, deduplication, scheduling, worker concurrency, chains/batches,
failed-job persistence, and graceful shutdown.

### End-to-end tests

Exercise at least one complete path:

```text
HTTP request -> action -> model -> commit -> outbox -> worker -> notification/broadcast
```

An end-to-end test should assert externally observable outcomes, not mirror internal method calls.

### Architecture tests

Static tests prevent feature code from directly importing Prisma, Nest CQRS, BullMQ, Redis
clients, or vendor SDKs. Generator tests verify that newly scaffolded features obey the same rules.

## Fakes and production parity

Fakes model the contract, including meaningful failures. A fake queue that can never duplicate or
retry work is insufficient for testing idempotency. A fake cache should support expiry and locks
when code depends on those behaviors.

Fakes provide speed and control; integration tests prove the real adapter semantics.

## Failure model

Canopy distinguishes:

- Validation failures
- Authentication and authorization failures
- Missing models
- Optimistic concurrency conflicts
- Configuration and registration failures
- Retryable infrastructure failures
- Exhausted/dead asynchronous work
- Unexpected application defects

Errors should retain structured context and have one deliberate mapping at each boundary. A queue
handler does not need an HTTP status code; an HTTP controller does not need to understand BullMQ
internals.

## Idempotency

Queued listeners, jobs, webhook handlers, and replay commands must assume repeated delivery.
Idempotency keys should be derived from stable input such as event ID, outbox ID, vendor request ID,
or a domain operation key.

Do not rely on a process-local set or cache alone when duplicate execution would create durable
business effects.

## Operational commands

The `canopy` CLI should support inspection and recovery without requiring hand-written database
updates:

- List and retry failed jobs
- List, inspect, and retry outbox entries
- List synchronized schedules
- Inspect model metadata
- Generate framework-compliant feature types and migrations

Operational commands must be safe by default, explicit about environment, and auditable when they
change durable state.

## Deployment expectations

API, worker, contracts, job definitions, and migrations form one compatibility set. Deployments
must account for rolling-version overlap:

- Additive schema changes precede code that requires them.
- Job and event payloads are versioned.
- Workers tolerate messages created by the currently deployed producer set.
- Removed handlers are not deployed while relevant outbox or queue entries remain.
- Schedule synchronization is deterministic.

## Readiness checklist

Before a feature is considered production-ready:

- Domain invariants have unit tests.
- Authorization and data scope are tested.
- Writes prove snapshot/journal/outbox atomicity when applicable.
- Remote effects are not executed inside transactions.
- Queue handlers are idempotent and have retry tests.
- Public contracts have compatibility tests.
- Logs and errors carry correlation context.
- Feature code passes architectural import checks.
- Relevant recovery operations are documented.

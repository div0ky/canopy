# PostgreSQL Durability Vertical Slice

- **Status:** Implemented proof
- **Implemented:** 2026-07-10
- **MVP status:** Incomplete
- **Depends on:** [Execution and operations vertical slice](execution-operations-vertical-slice.md)

## Outcome

The third Doxa implementation proves this durability path end to end:

```text
admitted action execution
  → PostgreSQL/Drizzle transaction
  → active Doxa Unit of Work
  → entity-state write with optimistic concurrency
  → journal fact + outbox message + causal metadata
  → one atomic PostgreSQL commit
  → after-commit work becomes eligible
```

An action failure after all three writes rolls the transaction back and releases no after-commit
work. A query receives a read-only Unit of Work and fails before touching PostgreSQL.

## Boundary

Application operations import persistence vocabulary from `@doxajs/core` only:

```ts
export class SaveCounter extends Action<SaveCounterInput, SaveCounterResult> {
  static id = 'save-counter'

  private readonly unitOfWork = this.inject(UnitOfWork)
}
```

Only the composition provider imports the adapter:

```ts
export class PersistenceTransactions extends PostgresTransactionManager {
  static id = 'transactions'

  constructor(config: DatabaseConfig) {
    super({ connectionString: config.connectionString })
  }
}
```

The database URL is declared as `SecretString`. It remains redacted under string coercion and JSON
serialization and is explicitly revealed only inside the PostgreSQL composition provider.

Action and query source contains no Drizzle, `pg`, table, SQL, database-session, or driver-error
types. The generated semantic manifest contains the stable `doxa:unit-of-work` identity and
transaction capability without engine types.

## Unit of Work proof

The initial low-level `UnitOfWork` contract can:

- Load versioned entity state.
- Insert or update entity state with an expected version.
- Append a named journal fact.
- Append a pending outbox message.
- Register work that cannot run until commit succeeds.

The runtime activates exactly one Unit of Work inside each top-level action transaction and makes it
constructor-injectable through the current execution scope. It does not create a second container
scope. The object becomes stale as soon as the transaction callback ends, and later use fails with
`StaleUnitOfWorkError`.

This low-level API is framework plumbing and a vertical-proof seam. It is not the desired ordinary
application persistence experience. The completed
[Eloquent-style model vertical slice](eloquent-model-vertical-slice.md) now places hydrated models,
`save()`, and dirty tracking above it so normal actions do not hand-author entity-state records,
journal facts, and outbox messages. Custom mapper registration and lifecycle observers remain future
model-runtime work.

## PostgreSQL and Drizzle adapter

`@doxajs/postgres-drizzle` owns:

- The lifecycle-managed `pg` connection pool.
- Drizzle transaction creation and transaction-scoped queries.
- The PostgreSQL entity-state, journal, and outbox schema.
- Stable optimistic-concurrency and persistence error translation.
- Durable execution-context envelopes.
- After-commit release after the database transaction promise confirms commit.

The proof pins Drizzle ORM 0.45.2 and `pg` 8.22.0. PostgreSQL conformance currently runs against the
locally available `postgres:17-alpine` image. Runtime boot never creates or migrates tables. The
explicit migration helper is used only by tests and future migration tooling.

The initial generic `doxa_entity_states` table proves the framework transaction and concurrency
contract; it does not mandate that every future Doxa model use one JSON record. Model mappers may
target domain tables or multiple records while retaining the same Unit of Work guarantees.

## Atomicity and concurrency

- New entities insert at version 1.
- Existing entities update only when the stored version equals `expectedVersion`.
- Competing writers produce one winner and one stable `OptimisticConcurrencyError`.
- Entity state, journal, and outbox writes use the identical Drizzle transaction.
- An action exception rolls all three back.
- Query mode receives a read-only Unit of Work that rejects every persistence method.
- Application exceptions retain their original identity; only actual PostgreSQL failures are
  normalized as persistence errors.

## Causality

Every journal and outbox record receives a durable envelope containing:

- Execution ID.
- Correlation and optional causation ID.
- Actor and initiator opaque references.
- Tenant when present.
- Delegation hops when present.
- Trace linkage when present.

Credentials, session tokens, loaded permissions, arbitrary baggage, and cancellation objects are not
persisted.

## After commit

Callbacks registered through `unitOfWork.afterCommit()` remain private until PostgreSQL confirms
commit. A conformance callback queries through another pool connection and observes the durable row,
proving it did not execute inside the transaction.

If an after-commit callback fails, Doxa throws `AfterCommitError` while retaining the committed
state. It does not claim rollback after durability has already been established.

## Executable evidence

At completion of this slice, the suite contained twenty-three passing tests. The Docker-backed
PostgreSQL tests prove:

1. Manifest-visible transaction and Unit of Work capabilities without engine leakage.
2. Atomic entity-state, journal, and outbox commit.
3. Complete rollback after application failure following all writes.
4. Actor, initiator, tenant, execution, correlation, and causation persistence.
5. Read-only query rejection before SQL.
6. Deterministic optimistic-concurrency conflict behavior.
7. After-commit visibility from another database connection.
8. Stable stale-Unit-of-Work failure.
9. Durable state remains committed when after-commit processing fails.
10. Explicit schema installation rather than migration-on-boot.

Run the proof with `pnpm test`. Docker must be available for the PostgreSQL conformance suite.

## Next slice

Completed: [Eloquent-style model vertical slice](eloquent-model-vertical-slice.md).

# 0002: Use PostgreSQL and Drizzle for Persistence

- **Status:** Accepted
- **Accepted:** 2026-07-10
- **Decision owners:** Canopy maintainers

## Decision

Canopy will use PostgreSQL as its initial relational database and Drizzle ORM as its private schema,
query, and transaction engine. Canopy will continue to own domain models, persistence semantics,
units of work, lifecycles, repositories, journal behavior, and durable delivery.

Drizzle is the SQL engine beneath Canopy. It is not Canopy's domain-model API.

## Context

Canopy requires more than type-safe CRUD. A mutating application operation must be able to:

1. Load and mutate behavior-bearing domain models.
2. detect optimistic concurrency conflicts.
3. Persist entity state.
4. Append domain journal entries.
5. Append transactional outbox records.
6. Commit those writes atomically.
7. Release after-commit and asynchronous work only after durability is established.

The selected persistence engine must make these guarantees straightforward without imposing its own
application model. It must also support optimized reads, reviewable migrations, PostgreSQL features,
clear transaction scoping, instrumentation, and deterministic lifecycle management.

## Why Drizzle

Drizzle is a thin, typed layer over SQL with SQL-like and relational query APIs. Its transaction API
exposes a transaction-scoped database object and supports nested savepoints. Its schema tooling can
generate SQL migration artifacts that remain visible and reviewable.

These characteristics make Drizzle comparatively easy to contain inside a Canopy adapter. Canopy can
use Drizzle for query construction, mapping, transactions, and schema tooling without asking feature
code to adopt Drizzle as its application vocabulary.

## Why PostgreSQL

The initial persistence model relies on relational transactions, constraints, optimistic
concurrency, JSON where appropriate, and reliable claiming of outbox work. PostgreSQL provides a
strong, well-understood foundation for these requirements and allows the first Canopy adapter to be
deliberately specific instead of pretending all SQL databases behave identically.

Canopy will model the guarantees it needs. It will not claim database portability until another
adapter proves those guarantees through the same conformance suite.

## Boundary

Domain and feature code must not import:

- Drizzle database or transaction types.
- Drizzle table definitions or query builders.
- PostgreSQL driver types.
- Drizzle or driver errors.

Infrastructure code may use Drizzle directly when implementing repositories, read models,
migrations, and the persistence adapter. The adapter translates database failures into stable Canopy
persistence errors.

The physical schema and the domain model have different responsibilities:

- Canopy domain models are the source of truth for behavior, invariants, lifecycle, and emitted
  domain events.
- Drizzle schema definitions are the source of truth for the physical PostgreSQL representation.
- Adapter mappings translate between durable records and domain state.

Canopy will not create a second column-definition language merely to compile it into Drizzle.

## Transaction integration

A mutating action will use this execution shape:

```text
HTTP or job invocation
  -> Canopy execution context
  -> validation and authorization
  -> Canopy unit of work
  -> Drizzle transaction
  -> entity state + journal + outbox writes
  -> commit
  -> after-commit listeners and outbox availability
```

The active transaction belongs to the Canopy execution scope. Repositories resolve a Canopy-owned
database session from that scope; handlers do not receive a Drizzle transaction.

The unit-of-work specification must decide whether nested units of work join the current
transaction, create a savepoint, or are prohibited. Drizzle's support for savepoints supplies a
mechanism but does not decide Canopy semantics.

## Schema and migration workflow

The migration workflow is:

1. Define the physical schema in TypeScript using Drizzle.
2. Generate SQL migrations through a Canopy CLI command backed by Drizzle Kit.
3. Review and commit the generated SQL.
4. Apply migrations as an explicit deployment step.
5. Inspect migration state during diagnostics and readiness without mutating it.

Production applications must not apply migrations opportunistically during normal boot. Schema-push
workflows are limited to disposable local development environments. Custom SQL migrations remain
first-class when PostgreSQL capabilities cannot be expressed cleanly through the schema generator.

## Prisma alternative

Prisma provides an excellent generated client, declarative schema, migration system, and tooling. It
is the stronger choice when Prisma's generated persistence model is intended to become the
application's data-access model.

That strength creates tension for Canopy. Prisma's schema and generated client establish their own
model and query vocabulary, while Canopy intends to own behavior-bearing domain models,
repositories, lifecycles, units of work, and diagnostics. Prisma can be contained behind
repositories, but doing so discards more of its primary developer experience and creates stronger
pressure for generated types to leak into feature code.

Prisma is therefore not the preferred engine for the initial adapter. It remains an alternative if
the Drizzle proof shows that the thinner layer forces Canopy to build excessive persistence
machinery.

## Consequences

- Canopy receives explicit control over SQL, transactions, locking, and outbox delivery.
- Physical schemas and migrations remain visible to developers and operators.
- Domain models remain independent of database records and query-result shapes.
- Repository mappings introduce some ceremony that generators or conventional mappers may need to
  reduce.
- Canopy must define more persistence behavior than it would if it exposed a generated ORM client
  directly.
- PostgreSQL-specific behavior is intentional in the first adapter.
- Drizzle versions must be pinned and upgraded through Canopy's compatibility process.

## Required implementation proof

A vertical proof must demonstrate:

1. A request dispatches an action without exposing Hono or Drizzle types to feature code.
2. The action loads and mutates a behavior-bearing model.
3. An optimistic concurrency conflict becomes a stable Canopy error.
4. The entity-state writes, journal entry, and outbox record commit atomically.
5. A failed action leaves none of those records partially persisted.
6. After-commit work cannot run before the transaction commits.
7. An outbox worker can safely claim concurrent work and retry failed delivery.
8. Traces and diagnostics connect the action, transaction, SQL operations, and outbox delivery.
9. Tests can replace persistence through Canopy APIs without mocking Drizzle.
10. Generated and custom migrations coexist in one reviewable workflow.

The proof should also measure whether repository mapping and transaction scoping remain simple
enough to support the desired Canopy programming experience.

## Revisit when

- The vertical proof requires Drizzle types in normal feature code.
- Mapping overhead makes ordinary persistence meaningfully harder than the framework promise allows.
- Drizzle cannot express or safely escape to the PostgreSQL operations required by the journal and
  outbox.
- Drizzle's release stability or upgrade behavior cannot satisfy Canopy's compatibility contract.
- Prisma or another engine can meet the same boundary with substantially less framework machinery.

## Implementation evidence

The
[PostgreSQL durability vertical slice](../implementation/postgresql-durability-vertical-slice.md)
proves atomic entity-state, journal, and outbox writes, rollback, optimistic concurrency,
after-commit visibility, durable causal metadata, and the Drizzle boundary against PostgreSQL.

## References

- [Canopy Architecture: mutating work](../architecture.md#mutating-work)
- [Canopy Architecture: durable side effects](../architecture.md#durable-side-effects)
- [Drizzle overview](https://orm.drizzle.team/docs/overview)
- [Drizzle transactions](https://orm.drizzle.team/docs/transactions)
- [Drizzle migrations](https://orm.drizzle.team/docs/migrations)
- [Prisma ORM overview](https://www.prisma.io/docs/orm)

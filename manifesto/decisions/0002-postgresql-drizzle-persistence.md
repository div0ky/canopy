# 0002: Use PostgreSQL and Drizzle for Persistence

- **Status:** Accepted
- **Accepted:** 2026-07-10
- **Amended:** 2026-07-20 — Adopt developer-authored, Laravel-like forward migration workflow.
- **Decision owners:** Doxa maintainers

## Decision

Doxa will use PostgreSQL as its initial relational database and Drizzle ORM as its private SQL,
query, mapping, and transaction engine. Doxa will continue to own domain models, persistence
semantics, units of work, lifecycles, repositories, journal behavior, durable delivery, and the
migration lifecycle.

Drizzle is the SQL engine beneath Doxa. It is not Doxa's domain-model API.

## Context

Doxa requires more than type-safe CRUD. A mutating application operation must be able to:

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
exposes a transaction-scoped database object and supports nested savepoints. Its schema definitions
and SQL builder give Doxa adapters typed mappings for framework-owned tables without becoming the
application's schema-authoring or migration API.

These characteristics make Drizzle comparatively easy to contain inside a Doxa adapter. Doxa can use
Drizzle for query construction, mapping, and transactions without asking feature code to adopt
Drizzle as its application vocabulary.

## Why PostgreSQL

The initial persistence model relies on relational transactions, constraints, optimistic
concurrency, JSON where appropriate, and reliable claiming of outbox work. PostgreSQL provides a
strong, well-understood foundation for these requirements and allows the first Doxa adapter to be
deliberately specific instead of pretending all SQL databases behave identically.

Doxa will model the guarantees it needs. It will not claim database portability until another
adapter proves those guarantees through the same conformance suite.

## Boundary

Domain and feature code must not import:

- Drizzle database or transaction types.
- Drizzle table definitions or query builders.
- PostgreSQL driver types.
- Drizzle or driver errors.

Infrastructure code may use Drizzle directly when implementing repositories, read models, and the
persistence adapter. The adapter translates database failures into stable Doxa persistence errors.

The physical schema and the domain model have different responsibilities:

- Doxa domain models are the source of truth for behavior, invariants, lifecycle, and emitted domain
  events.
- Reviewed forward-only SQL migrations are the source of truth for the physical PostgreSQL schema.
- Private Drizzle schema definitions map framework-owned tables for typed adapter access and must
  remain consistent with their reviewed migrations.
- Adapter mappings translate between durable records and domain state.

Doxa model declarations are not a schema-definition language and do not generate DDL. A model may
map a compatible existing table without Doxa owning that table's migration history.

## Transaction integration

A mutating action will use this execution shape:

```text
HTTP or job invocation
  -> Doxa execution context
  -> validation and authorization
  -> Doxa unit of work
  -> Drizzle transaction
  -> entity state + journal + outbox writes
  -> commit
  -> after-commit listeners and outbox availability
```

The active transaction belongs to the Doxa execution scope. Repositories resolve a Doxa-owned
database session from that scope; handlers do not receive a Drizzle transaction.

The unit-of-work specification must decide whether nested units of work join the current
transaction, create a savepoint, or are prohibited. Drizzle's support for savepoints supplies a
mechanism but does not decide Doxa semantics.

## Schema and migration workflow

The migration workflow is:

1. Create a timestamped forward migration with `doxa make:migration <Name>`.
2. Author the production-safe SQL explicitly.
3. Review and commit the migration artifact.
4. Apply pending framework and application migrations with `doxa migrate` as an explicit deployment
   step.
5. Record successful applications, immutable checksums, and batches in `doxa_migrations`.
6. Inspect migration state with `doxa migrate:status` without mutating it.

This workflow is deliberately Laravel-like in ownership: developers author migrations while Praxis
orders, applies, and tracks them. Unlike Laravel's conventional reversible migration classes, Doxa
migrations are forward-only SQL and do not promise destructive rollback. Production applications
must not apply migrations opportunistically during normal boot. Schema-diff and schema-push
workflows are not part of the Doxa application contract.

## Prisma alternative

Prisma provides an excellent generated client, declarative schema, migration system, and tooling. It
is the stronger choice when Prisma's generated persistence model is intended to become the
application's data-access model.

That strength creates tension for Doxa. Prisma's schema and generated client establish their own
model and query vocabulary, while Doxa intends to own behavior-bearing domain models, repositories,
lifecycles, units of work, and diagnostics. Prisma can be contained behind repositories, but doing
so discards more of its primary developer experience and creates stronger pressure for generated
types to leak into feature code.

Prisma is therefore not the preferred engine for the initial adapter. It remains an alternative if
the Drizzle proof shows that the thinner layer forces Doxa to build excessive persistence machinery.

## Consequences

- Doxa receives explicit control over SQL, transactions, locking, and outbox delivery.
- Physical schemas and migrations remain visible to developers and operators.
- Domain models remain independent of database records and query-result shapes.
- Repository mappings introduce some ceremony that generators or conventional mappers may need to
  reduce.
- Doxa must define more persistence behavior than it would if it exposed a generated ORM client
  directly.
- PostgreSQL-specific behavior is intentional in the first adapter.
- Drizzle versions must be pinned and upgraded through Doxa's compatibility process.

## Required implementation proof

A vertical proof must demonstrate:

1. A request dispatches an action without exposing Hono or Drizzle types to feature code.
2. The action loads and mutates a behavior-bearing model.
3. An optimistic concurrency conflict becomes a stable Doxa error.
4. The entity-state writes, journal entry, and outbox record commit atomically.
5. A failed action leaves none of those records partially persisted.
6. After-commit work cannot run before the transaction commits.
7. An outbox worker can safely claim concurrent work and retry failed delivery.
8. Traces and diagnostics connect the action, transaction, SQL operations, and outbox delivery.
9. Tests can replace persistence through Doxa APIs without mocking Drizzle.
10. Framework-owned and developer-authored application migrations coexist in one reviewable,
    forward-only workflow.

The proof should also measure whether repository mapping and transaction scoping remain simple
enough to support the desired Doxa programming experience.

## Revisit when

- The vertical proof requires Drizzle types in normal feature code.
- Mapping overhead makes ordinary persistence meaningfully harder than the framework promise allows.
- Drizzle cannot express or safely escape to the PostgreSQL operations required by the journal and
  outbox.
- Drizzle's release stability or upgrade behavior cannot satisfy Doxa's compatibility contract.
- Prisma or another engine can meet the same boundary with substantially less framework machinery.

## Implementation evidence

The
[PostgreSQL durability vertical slice](../implementation/postgresql-durability-vertical-slice.md)
proves atomic entity-state, journal, and outbox writes, rollback, optimistic concurrency,
after-commit visibility, durable causal metadata, and the Drizzle boundary against PostgreSQL.

## References

- [Doxa Architecture: mutating work](../architecture.md#mutating-work)
- [Doxa Architecture: durable side effects](../architecture.md#durable-side-effects)
- [Drizzle overview](https://orm.drizzle.team/docs/overview)
- [Drizzle transactions](https://orm.drizzle.team/docs/transactions)
- [Prisma ORM overview](https://www.prisma.io/docs/orm)

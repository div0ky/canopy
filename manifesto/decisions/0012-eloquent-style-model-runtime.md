# 0012: Provide an Eloquent-Style Persistent Model Runtime

- **Status:** Accepted
- **Accepted:** 2026-07-10
- **Decision owners:** Canopy maintainers

## Decision

Canopy will provide Eloquent-style persistent model ergonomics as an MVP requirement. Applications
may retrieve hydrated models, invoke behavior, mutate state, inspect changes, and explicitly persist
through model methods such as `save()`.

Canopy implements this experience through an execution-scoped model session, Unit of Work, and
Data Mapper over Drizzle. Models do not import Drizzle, database clients, table definitions, or row
types.

## Public experience

The intended application experience is:

```ts
const order = await Order.findOrFail(orderId);

order.changeShippingAddress(address);
order.confirm();

await order.save();
```

The MVP model API should include:

```text
Model.find(id)
Model.findOrFail(id)
Model.create(attributes)

model.save()
model.delete()
model.refresh()

model.isDirty()
model.isClean()
model.wasChanged()
model.getChanges()
model.getOriginal()
model.exists
model.version
```

The exact naming and overloads remain specification work, but the hydrated-object and explicit-save
experience is accepted.

## Entity, model, record, and state

- An **entity** is an identity-bearing domain concept.
- A persistent **model** is Canopy's object-oriented runtime representation of a stored entity.
- A **record** or row is part of its physical database representation.
- **Entity state** is the authoritative persisted information used to rehydrate the model.
- A **snapshot** is reserved for an actual point-in-time capture or checkpoint and is not the
  default name for an authoritative database row.

One model may map to several records. A record is not automatically the domain entity.

## Attachment and hydration

Models hydrated through Canopy are attached to the active execution-scoped `ModelSession`.
Canopy tracks attachment, original state, current changes, persistence status, and version through
private framework metadata rather than public model attributes.

For an ordinary single-table model, safe physical-name differences use Laravel-like metadata on
the model without importing Drizzle:

```ts
export class Order extends Model<OrderAttributes> {
  static table = 'sales_orders'
  static primaryKey = 'order_id'
}
```

Column, timestamp, and version overrides follow the same model-owned metadata contract. Complex
multi-record persistence continues to use an explicit infrastructure mapping:

```ts
persist(Order).using(
  drizzleModel({
    table: orders,
    id: orders.id,
    version: orders.version,
    hydrate: row => Order.rehydrate(row),
    dehydrate: order => order.toPersistence(),
  }),
);
```

Simple metadata is compiled and validated by Canopy. Advanced mapping is infrastructure
composition. In neither path does feature or domain code import a table object or adapter. The
complete existing-table contract is recorded by
[Decision 0023](0023-existing-table-model-auth-mapping.md).

## Save semantics

`save()` requires an active mutating execution and Unit of Work. It must not silently create an
independent transaction.

Saving a model will:

1. Confirm the model is attached to the current execution and is writable.
2. Determine whether the model is new or persisted.
3. Calculate dirty state.
4. Run pre-persistence lifecycle observers.
5. Validate framework and model invariants.
6. Write entity state through the registered mapper.
7. Enforce optimistic concurrency using the model version.
8. Collect explicit domain events.
9. Stage journal and outbox records in the active transaction.
10. Run post-persistence, pre-commit lifecycle observers.
11. Update the model's version, original state, and change metadata.

The write occurs when `save()` is awaited, but the surrounding action transaction commits only
after the handler and required pre-commit phases complete. A later failure rolls back the state,
journal, and outbox writes together.

Saving a detached model throws a stable detached-model error. Saving after its execution has ended
throws a stale-execution error. Saving inside a query or other read-only execution throws a stable
read-only-execution error.

## Lifecycle observers

The initial model lifecycle should distinguish:

```text
retrieved

saving
  creating | updating
    persistence write
  created | updated
saved

committed
```

- `saving`, `creating`, and `updating` run before the persistence write.
- `created`, `updated`, and `saved` run after the write but before commit.
- `committed` runs only after transaction durability.
- Remote side effects use outbox-backed queued listeners rather than ordinary pre-commit observers.

Domain events remain explicit facts raised by model behavior. Model lifecycle notifications do not
become substitutes for domain events.

The MVP will not provide an unrestricted `saveQuietly()` or global lifecycle muting API. Bypassing
required journal, outbox, audit, or observer behavior must not be an ordinary escape hatch.

## Dirty tracking

Canopy tracks original persisted values and changes made since hydration or the last successful
save. A successful save marks the current values clean and retains the last saved change set for
`wasChanged()` and diagnostics.

Dirty tracking must use persistence mappings rather than proxies over arbitrary model properties.
Derived fields, private caches, collaborators, and transient state are not persisted merely because
they exist on the object.

## Static retrieval

Static retrieval methods such as `find` and `findOrFail` resolve the current `ModelSession` through
Canopy's execution context. They are Canopy model APIs, not Drizzle query builders.

The MVP does not need to reproduce Eloquent's complete query-builder surface. Complex reports,
projections, aggregates, and optimized reads remain the responsibility of query handlers and read
models behind Canopy-owned contracts.

## Repositories

Repositories and mappers remain part of the persistence architecture, but they are not mandatory
application ceremony for ordinary model work.

- Normal application path: static model retrieval and instance persistence methods.
- Framework internals: model session, Unit of Work, mapper, and persistence adapter.
- Advanced domain boundary: an explicit repository port where its abstraction is useful.
- Optimized reads: query handlers and read models.

## Consequences

- Canopy embraces Active Record ergonomics without giving models direct database-engine authority.
- Persistence magic remains bounded by the accepted execution scope and transaction lifecycle.
- The framework owns hydration, attachment, dirty tracking, lifecycle, optimistic concurrency, and
  model diagnostics.
- Drizzle continues to own SQL construction, physical schema definitions, and database mechanics.
- Detached models and background work require explicit reload or reattachment through Canopy APIs.
- Bulk writes that bypass hydration cannot claim normal model lifecycle semantics.

## Required implementation proof

The MVP must prove:

1. New and persisted model `save()` behavior.
2. Hydration and dehydration without Drizzle types in the model.
3. Dirty, clean, original, changed, and recently-created state.
4. Optimistic concurrency conflicts across executions.
5. Lifecycle ordering before write, after write, and after commit.
6. Atomic state, journal, and outbox behavior when the action commits or rolls back.
7. Stable failures for detached, stale, and read-only model saves.
8. Identical model-session behavior in HTTP, job, schedule, console, and listener executions.
9. Test fakes that preserve model lifecycle and Unit of Work semantics.
10. Explicit behavior for bulk updates and deletes that do not hydrate models.

The [Eloquent-style model vertical slice](../implementation/eloquent-model-vertical-slice.md)
implements the first executable proof of declarations, hydration, identity mapping, static lookup,
instance persistence, dirty tracking, attachment safety, optimistic concurrency, and atomic
model-driven journal/outbox durability. Mapper composition, observers, transport parity, test
fakes, and bulk semantics remain required before this proof satisfies the complete MVP contract.

## Revisit when

- `save()` cannot remain subordinate to the active Canopy transaction.
- Static retrieval requires a hidden global database connection outside execution context.
- Dirty tracking forces persistence concerns into arbitrary domain properties.
- Eloquent-style convenience makes actor, journal, outbox, or observer behavior ambiguous.
- The model runtime requires rebuilding Drizzle's SQL, schema, or migration engines.

## References

- [Laravel Eloquent](https://laravel.com/docs/13.x/eloquent)
- [Canopy persistence decision](0002-postgresql-drizzle-persistence.md)
- [Canopy OOP and container decision](0011-class-first-oop-container.md)
- [Canopy operation defaults](0009-operation-lifecycle-defaults.md)

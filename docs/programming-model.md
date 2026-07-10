# Programming model

## Anatomy of a feature

A representative feature contains only the pieces it needs:

```text
orders/
  order.model.ts
  order.actions.ts
  order.queries.ts
  order.events.ts
  order.listeners.ts
  order.observer.ts
  order.policy.ts
  order.resource.ts
  order.persistence.ts
  order.schedule.ts
  order.notification.ts
  orders.controller.ts
composition/
  prisma-order.persistence.ts
```

Small features should stay small. The framework vocabulary is a menu, not a requirement to create
one file of every kind.

## Actions

An action represents a requested state change or externally meaningful operation.

```ts
export class UpdateOrderAction extends Action<Order> {
  constructor(
    readonly id: string,
    readonly expectedVersion: number,
    readonly patch: UpdateOrderPatch,
  ) {
    super();
  }
}

@ActionHandler(UpdateOrderAction)
export class UpdateOrderHandler implements Handles<UpdateOrderAction, Order> {
  async handle(action: UpdateOrderAction): Promise<Order> {
    const order = await this.orders.findOrFail(action.id);
    const actor = this.context.current().actor;
    if (!actor) throw new Error('An authenticated actor is required');
    await this.authorization.authorize(actor, 'update', order);
    order.update(action.patch);
    return this.orders.save(order);
  }
}
```

Actions are named as verbs and domain outcomes: `CreateOrder`, `CancelAppointment`,
`AssignRepresentative`. They are not generic CRUD containers when the domain has more precise
language.

An action handler may orchestrate several collaborators. It should remain readable as a use-case
narrative and delegate invariants to models or domain services.

## Queries

Queries return read models, resources, or pages without mutating application state.

Queries may use optimized Prisma projections, SQL, search indexes, or read replicas through read
ports. They do not need to hydrate domain models merely to display data.

Query handlers must not emit domain events, schedule jobs, or quietly repair data. A read that
changes state is an action with a misleading name.

## Domain models

A model has:

- A stable identity
- Current and original attributes
- A concurrency token or version
- Dirty tracking
- Explicit creation and hydration paths
- Behavioral methods that protect invariants
- Collected domain events

Creation and hydration are different operations. Creation may validate new state and record an
event. Hydration reconstructs an existing snapshot without pretending it was just created.

Models expose domain language:

```ts
order.submit();
appointment.reschedule(date);
contact.confirmSmsOptIn(actor);
```

Prefer these over public mutation primitives such as `setStatus('submitted')`. Generic setters
move invariants out of the only object that can reliably protect them.

Models do not call persistence themselves. A store or `ModelManager` loads and saves them through
an explicit adapter.

## Observers

Observers handle model lifecycle concerns that are truly shared around persistence:

- `retrieved`
- `creating`, `saving`, `updating`, `deleting`, `restoring`
- `created`, `saved`, `updated`, `deleted`, `restored`
- `committed`

Before/after-save hooks run within the transaction and therefore must be deterministic and local.
The `committed` hook runs only after a successful commit.

Observers should not become a hidden second application layer. If behavior is central to the use
case, put it in the action or model. If it calls a vendor, make it queued work.

## Events and listeners

Events are typed, named, and versioned facts. Payloads are validated at creation. Names describe
what happened, not which listener should run.

Listeners declare whether they execute locally or through the queue. Queueable listeners must be
idempotent because delivery is at least once.

Audit events and integration events may share a common shape but do not automatically share a
delivery policy. Persisting an audit fact does not require broadcasting it to every listener.

## Policies

Policies answer whether an actor may perform an ability on a subject. Authentication establishes
identity; authorization decides capability.

Policy checks belong near the application intent, not only in a controller guard. Jobs, WebSocket
handlers, and internal callers must receive the same authorization semantics when they act for a
user.

Data scope—such as tenant or branch visibility—is applied in query/persistence boundaries as well
as policy checks. A `true` policy result must not accidentally turn an unscoped query into global
access.

## Resources and contracts

Resources deliberately serialize application output. They prevent persistence rows or domain
objects from becoming accidental public contracts.

Zod contracts define protocol shapes shared by clients and servers. Validation occurs at the
boundary; domain models still enforce business invariants because valid JSON is not necessarily a
valid business transition.

## Jobs and schedules

A job definition owns its stable name, version, payload schema, queue, retry behavior, timeout,
retention, priority, and deduplication key. Producers and workers share that definition.

Schedules dispatch jobs; they do not contain a second implementation of the job's behavior.
Schedule identifiers are stable across deployments so synchronization updates rather than
duplicates them.

## Batteries through explicit managers

Feature code receives Canopy managers for cache, storage, notifications, broadcasting, logging,
and tracing. These resemble Laravel's cohesive batteries while remaining constructor-injected and
replaceable in tests.

Use the narrowest capability that expresses the intent. Do not inject a database client because a
feature needs a cache counter, or a vendor SDK because it needs to send a notification.

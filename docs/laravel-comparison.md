# Comparison with Laravel

Canopy is inspired by Laravel's framework coherence, not intended as a TypeScript port of Laravel
or Eloquent.

## What Canopy borrows

Laravel gives developers a memorable, consistent vocabulary across the application. Canopy adopts
that product philosophy:

- Models with behavior and lifecycle hooks
- Events and listeners
- Jobs, queues, retries, and schedules
- Policies and authorization
- API resources and validation
- Notifications and broadcasting
- Cache and storage abstractions
- Generators and operational CLI commands
- Productive testing helpers and fakes

The goal is the same kind of fluency: once a developer learns the framework's path, unfamiliar
features become predictable.

## Where the designs differ

| Concern               | Laravel                                       | Canopy                                                                |
| --------------------- | --------------------------------------------- | --------------------------------------------------------------------- |
| Runtime               | Laravel/PHP application kernel                | Nest/Node runtime kernel                                              |
| Primary model style   | Eloquent Active Record                        | Behavioral `DomainModel` plus persistence adapter                     |
| Writes                | Model methods such as `save()`                | Action handler plus `ModelManager`/unit of work                       |
| Queries               | Eloquent static/query builder APIs            | Explicit `Query` handlers and read adapters                           |
| Relationships         | ORM relationships, commonly lazy/eager loaded | Explicit projections or repository loading; no lazy loading           |
| Lifecycles            | Eloquent model events and observers           | Transaction-defined model observers plus committed hooks              |
| Events                | Application events and queued listeners       | Typed, versioned events with explicit audit/delivery classes          |
| Durable async handoff | Queue dispatch, optionally after commit       | Transactional outbox for externally visible durable work              |
| Dependency access     | Container injection and facades               | Nest constructor injection through Canopy-owned ports/managers        |
| Database              | Eloquent schema/migrations                    | Prisma adapters and migrations at infrastructure boundary             |
| CQRS                  | Possible but not a default framework boundary | Actions and queries are the default application boundary              |
| API serialization     | API Resources                                 | Canopy resources plus runtime-neutral Zod contracts                   |
| CLI                   | Artisan                                       | `canopy` CLI                                                          |
| Testing               | Fakes, helpers, application test harness      | Canopy fakes plus Nest, PostgreSQL, Redis, BullMQ, and contract tests |

## DomainModel versus Eloquent

An Eloquent model combines domain-ish behavior with persistence, relationships, query construction,
serialization, and lifecycle events. This is highly productive for CRUD-heavy applications, but it
also allows database access and writes from almost anywhere.

A Canopy model deliberately owns less infrastructure and more domain responsibility:

```ts
// Laravel/Eloquent style
const order = await Order.findOrFail(id);
order.status = 'submitted';
await order.save();

// Canopy style
const order = await orders.findOrFail(id);
order.submit();
await orders.save(order);
```

The Canopy version is more explicit about the persistence boundary and gives `submit()` one place
to enforce invariants and record events. It costs a persistence adapter, but that adapter prevents
the domain object from becoming an ORM API.

## Observers and model events

Laravel observers provide convenient hooks such as `creating`, `updated`, and `deleted`. Canopy
uses similar lifecycle names because developers understand them, but gives them stricter
transaction semantics.

- In-transaction hooks may change local durable state.
- Committed hooks run only after success.
- Remote or retryable effects use the outbox and worker.

An observer that sends email during `updated` may be convenient, but it can send a message for a
transaction that later rolls back. Canopy makes that failure mode difficult to express accidentally.

## Actions and controllers

Laravel controllers often call models and services directly; action classes are a project
convention rather than a central framework primitive. Canopy makes actions and queries the standard
boundary because the same use case may be invoked by HTTP, WebSocket, a job, a webhook, or an
internal workflow.

The transport adapter becomes thin without making the action an anemic command object: the handler
still provides an obvious home for orchestration, authorization, and transaction-aware work.

## Facades and dependency injection

Laravel facades offer terse, readable calls such as `Cache::get()` and `Storage::disk()`. Canopy
provides similarly cohesive managers but injects them explicitly through Nest.

This makes dependencies visible in constructors, avoids process-global mutable state, and allows
tests to replace capabilities without facade bootstrapping. The tradeoff is a little more ceremony
in exchange for clearer boundaries.

## Queues and the outbox

Laravel has mature queues, retries, failed-job handling, and after-commit dispatch options. Canopy
adopts those capabilities while making the transactional outbox the normal path for durable side
effects originating from a domain commit.

The outbox is not merely a queue API preference. It protects against this failure:

```text
database commits -> process crashes -> queue dispatch never happens
```

The worker still uses BullMQ, but the database transaction records the obligation to dispatch.

## Policies, resources, notifications, cache, and storage

These batteries are intentionally familiar to Laravel developers. The main differences are:

- Runtime-neutral Zod contracts accompany resources.
- Policies compose with explicit tenant/branch scope.
- Notifications and broadcasts normally cross an outbox boundary.
- Storage and cache are injected ports with production adapters and fakes.
- Vendor-specific infrastructure stays outside feature code.

## What Canopy rejects from Laravel

Canopy deliberately rejects:

- Static model query APIs
- Implicit instance persistence
- Lazy relationship loading
- Hidden I/O from property access
- Static facades as the primary dependency mechanism
- Treating model lifecycle hooks as an unrestricted side-effect bus
- Coupling domain models to database serialization

These are not claims that Laravel's choices are universally wrong. They are choices optimized for a
different balance. Canopy favors explicit boundaries, concurrency safety, auditability, and
reliable asynchronous delivery in a TypeScript/Nest environment.

## The intended developer experience

A Laravel developer should recognize the vocabulary and batteries. A Nest developer should
recognize the DI container, modules, decorators, controllers, and lifecycle. A DDD/CQRS developer
should recognize intent-driven writes, behavioral models, explicit persistence, read projections,
and transactional event semantics.

Canopy's identity is the intersection of those strengths, not a disguised clone of any one of
them.

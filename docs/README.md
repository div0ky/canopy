# Canopy developer documentation

Canopy is an opinionated application framework for TypeScript teams that want Laravel's coherent
developer experience without giving up explicit domain behavior, CQRS boundaries, transactional
side effects, or Nest's runtime ecosystem.

Nest is Canopy's runtime kernel. Prisma, BullMQ, Redis, and vendor SDKs are infrastructure. Feature
code should primarily speak Canopy: models, actions, queries, events, listeners, jobs, schedules,
policies, resources, notifications, cache, storage, broadcasting, and testing fakes.

## Read this first

1. [Framework philosophy](philosophy.md) — the manifesto and the tradeoffs Canopy makes.
2. [Architecture](architecture.md) — packages, runtime processes, layers, and dependency direction.
3. [Programming model](programming-model.md) — how a feature is expressed in Canopy.
4. [Persistence and events](persistence-and-events.md) — snapshots, transactions, the journal,
   outbox, listeners, and concurrency.
5. [Runtime and batteries](runtime-and-batteries.md) — HTTP, workers, jobs, auth, cache, storage,
   notifications, broadcasting, and observability.
6. [Testing and operations](testing-and-operations.md) — test boundaries and production behavior.
7. [Conventions](conventions.md) — dependency rules, naming, structure, and review checklist.
8. [Laravel comparison](laravel-comparison.md) — what Canopy borrows, changes, and rejects.

## The short version

```text
request or job
  -> action or query
  -> behavioral model / read projection
  -> unit of work
  -> snapshot + journal + outbox commit
  -> after-commit work
  -> worker
  -> notification / broadcast / integration
```

Canopy optimizes for a boring, repeatable path from intent to durable state and reliable side
effects. It prefers a small amount of visible ceremony over behavior that is convenient locally
but surprising in production.

## Status of these documents

These documents define the intended application programming model. When an implementation detail
and these principles disagree, either the implementation is incomplete or the architectural
decision needs to be deliberately revised and documented. Accidental drift is not a third option.

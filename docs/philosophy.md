# Framework philosophy

## The manifesto

Canopy exists to make the correct application architecture the easiest architecture to use.

Laravel demonstrates that a framework can give developers one coherent vocabulary for models,
authorization, queues, notifications, storage, caching, scheduling, resources, and tests. Nest
demonstrates that TypeScript applications can have strong dependency injection, modular
composition, decorators, and an excellent runtime ecosystem. Domain-driven design and CQRS
demonstrate that business behavior becomes easier to protect when writes express intent and reads
do not masquerade as domain behavior.

Canopy combines those lessons:

- Laravel-like coherence and batteries
- Nest as the runtime and composition kernel
- Behavioral domain models rather than database records with methods attached
- Explicit actions and queries rather than controller-driven application logic
- Snapshot persistence plus an append-only audit journal
- Transactional outbox delivery for externally visible work
- Runtime-neutral contracts for boundaries shared by APIs, workers, and clients
- Infrastructure ports that keep Prisma, Redis, queues, and vendors out of feature code

## What Canopy is

Canopy is the application programming model used by normal feature code. It owns the vocabulary,
the happy path, lifecycle semantics, and failure rules.

Nest still provides dependency injection, process bootstrap, modules, HTTP adapters, WebSockets,
and lifecycle hooks. Canopy deliberately does not rebuild those facilities. It narrows how
application code uses them.

Canopy is also not an ORM. It coordinates domain models with explicit persistence adapters and a
unit of work. Prisma remains a persistence tool at the infrastructure boundary.

## Core principles

### 1. Intent is a first-class type

Every write enters through an `Action`. Every read enters through a `Query`. A developer should be
able to search for an intent and immediately find its handler, authorization, transaction, tests,
and result.

Controllers, gateways, scheduled tasks, and queue handlers translate external input into those
types. They do not become alternate homes for business logic.

### 2. Models protect behavior, not table shape

A `DomainModel` owns invariants, state transitions, dirty tracking, and emitted domain events. It
does not expose static database queries, call `save()` on itself, lazily load relationships, or
know which database stores it.

This keeps behavior testable without a database and prevents transport or persistence concerns
from becoming domain rules.

### 3. Persistence is explicit and atomic

Saving a model is a unit-of-work operation. Snapshot changes, audit journal entries, and queued
deliveries commit together. A successful return means the durable state transition succeeded. A
failure means none of those durable effects should be visible.

External network calls never belong inside that transaction.

### 4. Side effects declare their delivery semantics

Not every event should be published and not every listener should run at the same time. Canopy
distinguishes:

- Domain work that must occur inside the transaction
- Audit facts that are persisted but not broadcast
- Local work that runs only after commit
- Queueable work delivered through the outbox
- Integration signals derived from external or CDC input

Delivery semantics are part of correctness, not an implementation detail.

### 5. Defaults should be productive; boundaries should be strict

Canopy should generate and register the routine pieces of a feature. It should also fail loudly at
bootstrap when handlers are missing, duplicated, or incorrectly wired.

Convenience is welcome when it removes repetition. Convenience is rejected when it conceals I/O,
transactions, authorization, or remote work.

### 6. Feature code depends inward

Application and domain code import Canopy contracts, not Prisma clients, BullMQ, Redis clients, or
vendor SDKs. Infrastructure implements ports and is selected during composition.

This rule is enforced mechanically because architectural intentions that rely only on review will
eventually erode.

### 7. Production behavior must be testable locally

Every production battery has a testing fake or harness. Actions, models, policies, listeners,
jobs, cache operations, storage, notifications, broadcasting, logging, and time-sensitive work
must be testable without constructing the entire production runtime.

Integration tests still prove the real transaction, PostgreSQL, Redis, and BullMQ behavior.

### 8. Operations are framework features

Retries, idempotency, dead letters, outbox recovery, schedule synchronization, structured logs,
correlation identifiers, and graceful shutdown are not deployment trivia. They are part of the
programming model and must have documented, inspectable behavior.

## Deliberate non-goals

Canopy does not aim to provide:

- Active Record or Eloquent-compatible persistence
- Lazy-loaded relationships
- Static facades or process-global application state
- Automatic event sourcing or aggregate rehydration from events
- Hidden database queries triggered by property access
- A public HTTP endpoint for arbitrary job dispatch
- A second dependency injection container beside Nest
- A universal abstraction that makes every vendor look identical

## The standard of success

Canopy succeeds when a developer can open an unfamiliar feature and predict where its intent,
behavior, authorization, persistence, side effects, contracts, and tests live. The framework is
working when those conventions remain true under failure, concurrency, retries, and deployment—not
only in the happy-path example.

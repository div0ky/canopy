# Architecture

## Runtime shape

Canopy separates public request handling from asynchronous execution.

```text
clients and vendors
        |
        v
  API process (Nest)
  controllers / gateways
        |
        v
 actions and queries
        |
        +----> read adapters / projections
        |
        v
 models + unit of work
        |
        v
 PostgreSQL snapshot + journal + outbox
                                  |
                                  v
                           Worker process (Nest)
                           jobs / queued listeners
                                  |
                                  v
                    notifications / vendors / broadcasts
```

The API process may enqueue work but does not host production queue workers. The worker has no
public arbitrary-enqueue API. This limits blast radius and makes worker concurrency independently
deployable.

## Workspace responsibilities

### `apps/api`

- Boots the public Nest HTTP and WebSocket application
- Configures Canopy production drivers
- Translates transport input into actions and queries
- Serializes resources and unified response envelopes
- Authenticates requests and establishes execution context

### `apps/worker`

- Boots the standalone Nest worker application
- Hosts BullMQ workers and scheduled jobs
- Pumps the transactional outbox
- Executes queued event listeners and operational retries
- Shuts down queues and connections gracefully

### Feature packages or modules

- Define actions, queries, models, policies, resources, events, listeners, and jobs
- Export runtime-neutral application capabilities
- Depend on Canopy ports rather than vendor implementations

The example application currently lives in `apps/example`; larger systems may use packages or
bounded-context directories instead.

### `packages/canopy`

- Framework kernel and batteries
- Registries and bootstrap validation
- Execution context
- CQRS facades
- Domain model lifecycle and unit of work
- Event, outbox, job, scheduling, authorization, and testing APIs
- Production adapter interfaces and selected reusable implementations

### `packages/canopy-contracts`

- Runtime-neutral Zod schemas
- Request, response, cursor, and WebSocket contracts
- No Nest, database, queue, or vendor imports

### `packages/canopy-jobs`

- Runtime-neutral job names, versions, payload schemas, retries, and deduplication rules
- Shared safely by producers and workers

### `packages/db`

- Prisma schema and generated client
- Migrations and seed data
- Database-only concerns
- No business workflows

In an existing application, Canopy should adapt to the application's production database package.
Its example schema is not a framework-mandated domain schema.

## Layering

Feature code follows a dependency direction similar to ports and adapters:

```text
presentation -> application -> domain
                       |          ^
                       v          |
                 infrastructure --+
```

### Presentation

Controllers, gateways, webhook adapters, and resource serialization. Presentation validates
boundary input, creates actions or queries, and maps known errors to protocol responses.

### Application

Action handlers, query handlers, orchestration, authorization calls, and transaction boundaries.
Application code coordinates domain behavior; it does not reproduce it.

### Domain

Models, value objects, invariants, domain events, and domain-specific policies. Domain code is
independent of Nest, Prisma, queues, Redis, and vendors.

`DomainModel` itself is a Canopy base abstraction, but domain behavior should not depend on
Canopy's infrastructure APIs.

### Infrastructure

Prisma persistence adapters, Redis implementations, BullMQ dispatchers, storage disks, messaging
providers, observability adapters, and external service clients.

### Composition

Nest modules and `CanopyModule.forRootAsync()` choose concrete infrastructure and wire the process.
Composition may import vendors because its purpose is to assemble them. Feature code may not.

## Execution context

Canopy uses `AsyncLocalStorage` to carry request or job context without threading parameters
through every call:

- Actor and actor type
- Correlation and causation identifiers
- Trace identifier
- Locale
- Active transaction
- Deferred after-commit work

Context is scoped to one request or job execution. It is not a substitute for explicit business
input, and it must never leak between executions.

## Registries and bootstrap

Decorators register actions, queries, observers, listeners, jobs, policies, and schedules. Canopy
uses those registrations to reduce module boilerplate and validate the application at startup.

Bootstrap should fail for missing handlers, duplicate handlers, duplicate schedule identifiers,
or unresolved framework providers. Runtime discovery must remain deterministic; import order
cannot be allowed to make features appear or disappear.

## Public boundaries remain stable

Canopy is an internal framework. Adopting it should not require changing an application's HTTP
routes, WebSocket messages, webhook formats, or vendor callbacks. Presentation contracts can be
preserved while the implementation behind them is converted.

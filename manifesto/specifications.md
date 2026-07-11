# Canopy Specification Roadmap

The next Canopy implementation begins only after its critical contracts are specified. This page
turns the manifesto's initial specification set into a working knowledge-base roadmap.

The [MVP viability bar](mvp.md) requires a complete synchronous and asynchronous application model.
Focused vertical proofs may validate individual contracts during implementation, but they are not
the Canopy MVP.

## What a specification is

A Canopy specification defines externally observable behavior. It is more precise than design prose
and more durable than the implementation chosen to satisfy it.

Each specification should contain:

1. Purpose and boundaries.
2. Developer-facing vocabulary and examples.
3. Manifest representation, when applicable.
4. Runtime phases and ordering.
5. Success, failure, cancellation, and retry semantics.
6. Context and transaction behavior.
7. Diagnostics and observability.
8. Testing APIs and required fakes.
9. Escape hatches.
10. Adapter responsibilities and leak-prevention rules.
11. Conformance scenarios.
12. Open questions and explicit non-goals.

Normative statements should use **must**, **must not**, **should**, and **may** deliberately. Code
examples are illustrations unless the text declares them normative.

## Decision states

Every specification area should carry one status:

- **Unexplored** — named, but not yet investigated.
- **Exploring** — gathering constraints and comparing coherent designs.
- **Proposed** — one design is written and ready for challenge.
- **Accepted** — the contract is stable enough to implement.
- **Implemented** — at least one implementation passes its conformance suite.
- **Revising** — evidence requires a deliberate contract change.

Status describes confidence in the contract, not the amount of code written.

## Foundation

| Area                            | Status    | Central question                                                                                                                                   |
| ------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application and feature model   | Exploring | [How do explicit feature boundaries support automatic build-time registration?](decisions/0014-explicit-features-generated-manifest.md)            |
| Application manifest            | Exploring | [How does one versioned representation power boot, tooling, tests, and adapters?](decisions/0014-explicit-features-generated-manifest.md)          |
| Lifecycle and failure semantics | Exploring | [How do startup, readiness, drain, stop, disposal, deadlines, and failures compose?](decisions/0017-deterministic-runtime-lifecycle.md)            |
| Container and execution scopes  | Exploring | How do role-scoped `this.inject()` and service constructor injection remain automatic, explicit, and inspectable in TypeScript?                    |
| Package boundaries              | Exploring | [How does one application-facing core remain independent from compiler, runtime, testing, and adapters?](decisions/0018-public-package-surface.md) |

These specifications come first because every other subsystem participates in the application graph,
lifecycle, and execution scope.

## Application operations

| Area                           | Status                      | Central question                                                                                                                                                          |
| ------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actions and dispatch           | Exploring                   | What guarantees surround an intentional state change?                                                                                                                     |
| Queries and dispatch           | Exploring                   | How do optimized reads retain common context, policy, and error behavior?                                                                                                 |
| Domain models and repositories | Exploring                   | [How does Eloquent-style model persistence retain Canopy transaction semantics?](decisions/0012-eloquent-style-model-runtime.md)                                          |
| Existing-table model mapping   | MVP common path implemented | [How can ordinary models override table, key, column, timestamp, and version conventions without importing Drizzle?](decisions/0023-existing-table-model-auth-mapping.md) |
| Units of work and transactions | Exploring                   | Where do atomicity and after-commit behavior begin and end?                                                                                                               |
| Validation and error documents | Accepted                    | [How are Standard Schema inputs validated and represented consistently?](decisions/0006-standard-schema-zod-validation.md)                                                |
| Resources and serialization    | Unexplored                  | How does domain output become a stable external representation?                                                                                                           |

The [execution and operations vertical slice](implementation/execution-operations-vertical-slice.md)
provides executable evidence for the initial action, query, context, transaction-boundary, and scope
shape. These areas remain **Exploring** until their complete observable contracts and conformance
requirements are accepted.

The [PostgreSQL durability vertical slice](implementation/postgresql-durability-vertical-slice.md)
proves the initial transaction, Unit of Work, entity-state, journal, outbox, optimistic-concurrency,
and after-commit boundaries against a real PostgreSQL container. The complete model and persistence
specifications remain **Exploring**.

The [class events vertical slice](implementation/class-events-vertical-slice.md) proves typed local
and after-commit dispatch across the active execution and transaction. The complete event,
domain-event, signal, queue, serialization, and testing specifications remain **Exploring**.

## Events and asynchronous work

| Area                      | Status                          | Central question                                                                                                                                                                                                                   |
| ------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Journal and domain events | Exploring                       | [How do Laravel-like events distinguish general dispatch from durable domain facts?](decisions/0015-laravel-like-class-events.md)                                                                                                  |
| Outbox and delivery       | Exploring                       | How does committed intent reliably leave the transaction boundary?                                                                                                                                                                 |
| Listeners and observers   | Exploring                       | [Which local, after-commit, and queued phases does each reaction receive?](decisions/0015-laravel-like-class-events.md)                                                                                                            |
| Jobs and workers          | Exploring; implementation proof | How are context, retries, timeouts, uniqueness, and terminal failure defined?                                                                                                                                                      |
| Scheduling                | Implemented proof               | Class-first Job targets, cron/interval cadence, time zones, deterministic reconciliation, serialized overlap, skipped misfires, and causal system execution are proven; catch-up, operator state, fakes, and observability remain. |
| Mail and SMS              | Exploring                       | How are queued provider delivery and webhook outcomes normalized?                                                                                                                                                                  |

The [pg-boss queue and worker vertical slice](implementation/pg-boss-queue-worker-vertical-slice.md)
proves declared transactional jobs, atomic outbox handoff, retries, terminal retention, idempotency,
queued listeners, causal execution, and worker draining. Crash-process conformance, operator
recovery, testing fakes, advanced policies, and the complete asynchronous specification remain
**Exploring**.

## Interfaces and policy

| Area                              | Status                          | Central question                                                                                                                                                                                                                                                                                  |
| --------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP manifest                     | Exploring; implementation proof | What transport-neutral declaration does application code write?                                                                                                                                                                                                                                   |
| Hono adapter                      | Exploring; implementation proof | How is that declaration compiled without leaking Hono into features?                                                                                                                                                                                                                              |
| HTTP response envelopes           | Implemented                     | [How does Canopy automatically provide one discriminated success and failure grammar?](specifications/http-response-envelopes.md)                                                                                                                                                                 |
| Authentication                    | Implemented proofs              | Email/password identities, Argon2id credentials, browser sessions, opaque bearer tokens, actor resolution, authority propagation, rotation, CSRF origin enforcement, revocation, and audit are proven; verification, reset, abuse controls, renewal, testing helpers, and security review remain. |
| Existing-table auth mapping       | MVP common path implemented     | [How can first-party auth use an application's existing identity and credential columns while preserving Canopy security semantics?](decisions/0023-existing-table-model-auth-mapping.md)                                                                                                         |
| Authorization                     | Implemented proof               | [Default-deny manifest policies, entry access, resource decisions, bearer constraints, stable denial, security audit, testing fakes, and diagnostics are proven.](specifications/actor-execution-context-authorization.md)                                                                        |
| First-party roles and permissions | Deferred                        | [Policies and stable abilities remain core; role, grant, and permission persistence is intentionally deferred.](decisions/0022-defer-first-party-permissions.md)                                                                                                                                  |
| Execution context                 | Implemented proof               | [How are actor, tenant, causation, and security context propagated?](specifications/actor-execution-context-authorization.md)                                                                                                                                                                     |

The [Hono HTTP vertical slice](implementation/hono-http-vertical-slice.md) proves one class-first
route shape, manifest compilation, Web Standards adaptation, Standard Schema validation, anonymous
actor admission, stable errors, and Node host lifecycle. Authentication, middleware, resources,
policy, hardening, and the complete HTTP specification remain unsettled.

## Operations and developer experience

| Area                              | Status                                      | Central question                                                                                                                                              |
| --------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuration and secrets         | Exploring                                   | [How do injectable configuration classes resolve, validate, and protect declared values?](decisions/0021-injectable-configuration-classes.md)                 |
| Logging                           | Implemented                                 | [How do built-in structured records become contextual, redacted, color-coded local output and machine-readable production output?](specifications/logging.md) |
| Metrics and tracing               | Exploring                                   | Which actor and causal fields connect traces, journal entries, jobs, and audit records?                                                                       |
| Testing applications and fakes    | Exploring                                   | [How do direct unit tests and pre-boot derived test graphs preserve framework semantics?](decisions/0020-preboot-test-overrides.md)                           |
| CLI and generators                | Exploring                                   | [How do generators support opinionated defaults without making paths semantic?](decisions/0016-path-independent-structure-autowired-services.md)              |
| Development debugger              | Implemented                                 | [How does Undergrowth expose safe causal execution evidence without becoming audit or APM storage?](specifications/undergrowth.md)                            |
| Diagnostics                       | Implemented                                 | Arbor inspection, Drizzle Studio, and [Undergrowth](specifications/undergrowth.md) expose the compiled graph, storage, and live execution behavior.           |
| Adapter contracts                 | Unexplored                                  | Which guarantees and conformance cases apply to infrastructure engines?                                                                                       |
| Compatibility releases            | Unexplored                                  | How does a release declare and prove a supported component matrix?                                                                                            |
| Cultivate AI-assisted engineering | Accepted direction; implementation deferred | [How can agents safely inspect and work with a Canopy application?](future/ai-assisted-engineering.md)                                                        |
| Container deployment              | Accepted; implementation in progress        | [How does one immutable image safely run web, background, and migration roles?](specifications/container-deployment.md)                                       |

## Recommended authoring order

The documents should be authored in dependency order, not in order of visible product appeal:

1. Application model, manifest, lifecycle, scopes, and package rules.
2. Execution context, actions, queries, units of work, and errors.
3. Models, repositories, journal, outbox, observers, and listeners.
4. HTTP declarations, authentication, authorization, resources, and Hono adaptation.
5. Jobs, workers, retries, scheduling, and shutdown coordination.
6. Configuration, observability, testing, diagnostics, CLI, and compatibility releases.

Exploration can happen in parallel, but an accepted downstream specification must identify the
accepted upstream contracts it relies on.

## Acceptance bar

A specification is ready to become **Accepted** when:

- Its vocabulary agrees with the manifesto and neighboring specifications.
- Normal application code can be shown without infrastructure engine types.
- Lifecycle ordering and failure behavior are unambiguous.
- Transaction, durability, and context boundaries are stated.
- The testing surface can prove the promised semantics.
- Conformance scenarios cover boot, normal operation, failure, retry where relevant, and shutdown.
- Escape hatches do not undermine the primary programming model.
- Remaining open questions do not change the contract's foundation.

Implementation should begin with vertical proofs of accepted contracts, but implementation
convenience must not silently settle unresolved specification questions.

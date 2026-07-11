# Canopy Technology Decisions

This log records consequential technology and integration decisions derived from the
[Canopy Manifesto](../index.md). It exists so that selected tools do not become accidental
architecture and so that future changes can be evaluated against the reasoning that selected them.

## Decision states

- **Proposed** — the preferred direction is documented but still needs explicit acceptance or a
  focused technical proof.
- **Accepted** — the direction is part of Canopy's current design and constrains specifications.
- **Deferred** — the direction is viable and its prerequisites constrain current design, but its
  implementation intentionally waits for those prerequisites to stabilize.
- **Superseded** — a newer decision replaces this one without erasing its history.
- **Rejected** — the option was considered and deliberately not selected.

An accepted technology decision selects a role and a boundary, not an eternal dependency. Canopy
must still be intelligible if an engine is replaced.

## Current stack

| Concern | Selection | Status | Decision |
| --- | --- | --- | --- |
| Public HTTP contract | Web Standards `Request` and `Response` | Accepted | [HTTP engine](0001-hono-http-engine.md) |
| Initial HTTP engine | Hono with the Node.js adapter | Accepted | [HTTP engine](0001-hono-http-engine.md) |
| Application runtime | Node.js 24.7 or newer within the 24.x line | Accepted | [Runtime](0005-node-24-runtime.md) |
| Primary relational database | PostgreSQL | Accepted | [Persistence stack](0002-postgresql-drizzle-persistence.md) |
| Persistence and query engine | Drizzle ORM | Accepted | [Persistence stack](0002-postgresql-drizzle-persistence.md) |
| Database schema definition | Drizzle TypeScript schema | Accepted | [Persistence stack](0002-postgresql-drizzle-persistence.md) |
| Migration artifacts | Generated and reviewed SQL | Accepted | [Persistence stack](0002-postgresql-drizzle-persistence.md) |
| Domain model | Canopy-owned models and lifecycle | Accepted in principle | [Persistence stack](0002-postgresql-drizzle-persistence.md) |
| Mutation durability | Entity state, journal, and outbox in one transaction | Accepted in principle | [Persistence stack](0002-postgresql-drizzle-persistence.md) |
| Authentication | First-party Canopy subsystem | Accepted | [Authentication](0003-first-party-authentication.md) |
| Core credential method | Email and password | Accepted | [Authentication](0003-first-party-authentication.md) |
| Browser sessions | Opaque, database-backed sessions | Accepted | [Authentication](0003-first-party-authentication.md) |
| Additional credential methods | Optional Canopy auth plugins | Accepted | [Authentication](0003-first-party-authentication.md) |
| Authorization | Canopy-owned actors and policies | Accepted | [Actor and execution context](../specifications/actor-execution-context-authorization.md) |
| First-party roles and permission storage | Deferred; applications supply permission facts to policies | Deferred | [Permissions](0022-defer-first-party-permissions.md) |
| Execution context | Immutable actor and causal context | Accepted | [Actor and execution context](../specifications/actor-execution-context-authorization.md) |
| Project installer and generators | First-party Canopy CLI | Accepted | [CLI and generators](0004-first-party-cli-generators.md) |
| Validation contract | Standard Schema with Zod 4 as the default | Accepted | [Validation](0006-standard-schema-zod-validation.md) |
| MVP repository and test tooling | pnpm, ESM, strict TypeScript, Vitest, PostgreSQL test containers | Accepted | [MVP toolchain](0007-mvp-toolchain.md) |
| TypeScript compatibility | One compiler version pinned by each Canopy release | Accepted | [MVP toolchain](0007-mvp-toolchain.md#typescript-compatibility) |
| Decorator syntax | No Canopy decorators in MVP; optional manifest-equivalent frontend deferred | Deferred | [Decorators](0019-defer-decorator-syntax.md) |
| MVP email adapter | SendGrid plugin | Accepted | [Communications](0008-sendgrid-twilio-communications.md) |
| MVP SMS adapter | Twilio Messaging plugin | Accepted | [Communications](0008-sendgrid-twilio-communications.md) |
| Action and query defaults | One handler; transactional actions; non-mutating queries | Accepted | [Operation defaults](0009-operation-lifecycle-defaults.md) |
| Initial queue and scheduling engine | pg-boss on PostgreSQL | Accepted | [Queue and scheduling](0010-pg-boss-queue-scheduling.md) |
| Job execution guarantee | At-least-once with mandatory idempotency | Accepted | [Queue and scheduling](0010-pg-boss-queue-scheduling.md) |
| Primary programming model | Class-first OOP with manifest composition | Accepted | [OOP and container](0011-class-first-oop-container.md) |
| Class execution capabilities | Laravel-aligned queue, after-commit, synchronous dispatch, and broadcast semantics | Accepted | [OOP and container](0011-class-first-oop-container.md#role-classes-and-capability-traits) |
| Dependency container | First-party, reflection-free, build-time autowired | Accepted | [OOP and container](0011-class-first-oop-container.md) |
| Injection identities | Concrete classes, preferred abstract-class ports, and stable typed tokens | Accepted | [OOP and container](0011-class-first-oop-container.md#injection-identities) |
| Optional dependencies | Explicit `?` dependencies inject a valid binding or `undefined` | Accepted | [OOP and container](0011-class-first-oop-container.md#optional-dependencies) |
| Default dependency scope | Transient for zero-registration concrete services and handlers | Accepted | [OOP and container](0011-class-first-oop-container.md#container-scopes) |
| Construction semantics | Synchronous and side-effect-free; active work uses lifecycle phases | Accepted | [OOP and container](0011-class-first-oop-container.md#side-effect-free-construction) |
| Execution scopes | One scope per admitted entry point; new scope across durable async boundaries | Accepted | [OOP and container](0011-class-first-oop-container.md#container-scopes) |
| Runtime lifecycle | `start → ready → drain → stop → dispose` | Accepted | [Lifecycle](0017-deterministic-runtime-lifecycle.md) |
| Public lifecycle API | `Canopy.boot(Application)` and idempotent `runtime.shutdown()` | Accepted | [Lifecycle](0017-deterministic-runtime-lifecycle.md#public-lifecycle-api) |
| Readiness | Runtime-owned state after successful startup and checks | Accepted | [Lifecycle](0017-deterministic-runtime-lifecycle.md#readiness) |
| Lifecycle ordering | Dependency-derived startup with reversed shutdown ordering | Accepted | [Lifecycle](0017-deterministic-runtime-lifecycle.md#dependency-derived-ordering) |
| Startup failure | Full unwind; primary cause preserved with aggregated cleanup failures | Accepted | [Lifecycle](0017-deterministic-runtime-lifecycle.md#failure-and-observability) |
| Lifecycle deadlines | Runtime-owned deadlines and cancellation for every hook | Accepted | [Lifecycle](0017-deterministic-runtime-lifecycle.md#deadlines-and-cancellation) |
| Process signals | Node host adapters own signal wiring; `Canopy.boot()` has no global side effects | Accepted | [Lifecycle](0017-deterministic-runtime-lifecycle.md#process-host-integration) |
| Application declaration | Declaration-only composition; never constructed or executed | Accepted | [Features and manifest](0014-explicit-features-generated-manifest.md#declaration-only-application-class) |
| Runtime application object | Separate mutable object owns lifecycle and execution state | Accepted | [Features and manifest](0014-explicit-features-generated-manifest.md#declaration-only-application-class) |
| Feature declaration | Explicit role arrays maintained by generators | Accepted | [Features and manifest](0014-explicit-features-generated-manifest.md) |
| Feature execution | Declaration-only; Feature classes are never constructed or executed | Accepted | [Features and manifest](0014-explicit-features-generated-manifest.md#declaration-only-feature-classes) |
| Cross-Feature API | `provides` exposes concrete classes, abstract ports, or typed tokens | Accepted | [Features and manifest](0014-explicit-features-generated-manifest.md#feature-boundaries) |
| Dependency registration | Automatic constructor wiring beneath declared feature classes | Accepted | [Features and manifest](0014-explicit-features-generated-manifest.md) |
| Declaration compilation | Fail closed unless the complete graph is statically provable | Accepted | [Features and manifest](0014-explicit-features-generated-manifest.md#fail-closed-static-compilation) |
| Compiler analysis | TypeScript semantic Program and symbol identity; valid strict project required | Accepted | [Features and manifest](0014-explicit-features-generated-manifest.md#semantic-typescript-compilation) |
| Application graph | One versioned generated manifest shared by runtime and tooling | Accepted | [Features and manifest](0014-explicit-features-generated-manifest.md) |
| Graph mutability | Immutable after compilation; reload boots a replacement runtime | Accepted | [Features and manifest](0014-explicit-features-generated-manifest.md#immutable-application-graph) |
| Manifest identity | Required explicit IDs canonicalized as role, Feature, and local ID | Accepted | [Features and manifest](0014-explicit-features-generated-manifest.md#stable-manifest-identity) |
| Manifest artifact | Canonical, serializable `.canopy/manifest.json` | Accepted | [Features and manifest](0014-explicit-features-generated-manifest.md#generated-manifest-artifacts) |
| Runtime registry | Constructor-only `.canopy/registry.mjs` with no independent semantics | Accepted | [Features and manifest](0014-explicit-features-generated-manifest.md#generated-manifest-artifacts) |
| Artifact ownership | `.canopy/` is generated, gitignored, deterministic build output | Accepted | [Features and manifest](0014-explicit-features-generated-manifest.md#generated-manifest-artifacts) |
| Compilation ownership | Tooling compiles; runtime only validates and consumes artifacts | Accepted | [Features and manifest](0014-explicit-features-generated-manifest.md#compilation-ownership) |
| Manifest integrity | Manifest and registry share a required build hash | Accepted | [Features and manifest](0014-explicit-features-generated-manifest.md#generated-manifest-artifacts) |
| Manifest compatibility | Independently versioned format with fail-closed consumers | Accepted | [Features and manifest](0014-explicit-features-generated-manifest.md#manifest-format-compatibility) |
| Event authoring | Laravel-like class events with static dispatch and typed listeners | Accepted | [Events](0015-laravel-like-class-events.md) |
| Event durability | General events, journaled domain events, and immediate signals remain distinct | Accepted | [Events](0015-laravel-like-class-events.md) |
| Source organization | Paths have no runtime meaning; imports and Feature declarations establish ownership | Accepted | [Structure and services](0016-path-independent-structure-autowired-services.md) |
| File conventions | Kebab-case files, PascalCase classes, one primary role class, no required barrels | Accepted | [Structure and services](0016-path-independent-structure-autowired-services.md) |
| Ordinary services | Zero-registration concrete autowiring through constructor reachability | Accepted | [Structure and services](0016-path-independent-structure-autowired-services.md) |
| Cross-feature services | Private by default; intentional capabilities required for sharing | Accepted | [Structure and services](0016-path-independent-structure-autowired-services.md) |
| Application package | One primary programming-model surface through `@canopy/core` | Accepted | [Package surface](0018-public-package-surface.md) |
| Internal package graph | Physical separation of core, manifest, compiler, runtime, testing, and CLI | Accepted | [Package surface](0018-public-package-surface.md#internal-package-graph) |
| Package exports | Closed exports; no deep or relative cross-package imports | Accepted | [Package surface](0018-public-package-surface.md#closed-exports) |
| Testing package | Separate first-party `@canopy/testing` surface | Accepted | [Package surface](0018-public-package-surface.md) |
| Test overrides | Pre-boot, immutable, validated, and isolated per test application | Accepted | [Testing overrides](0020-preboot-test-overrides.md) |
| Configuration model | Injectable typed classes with direct property access | Accepted | [Configuration](0021-injectable-configuration-classes.md) |
| Environment mapping | Convention-derived names for declared configuration groups only | Accepted | [Configuration](0021-injectable-configuration-classes.md#convention-derived-environment-contract) |
| Configuration sources | Overrides, `process.env`, workspace-root `.env`, then defaults | Accepted | [Configuration](0021-injectable-configuration-classes.md#sources-and-precedence) |
| Adapter packages | Separate composition-boundary packages with no engine-type leakage | Accepted | [Package surface](0018-public-package-surface.md) |
| Persistent model experience | Eloquent-style hydration, mutation, dirty tracking, and `save()` | Accepted | [Model runtime](0012-eloquent-style-model-runtime.md) |
| Model persistence internals | Execution-scoped Unit of Work and Data Mapper over Drizzle | Accepted | [Model runtime](0012-eloquent-style-model-runtime.md) |
| Existing-table model mapping | Laravel-like table/key/column overrides on models, with explicit advanced mappers | Accepted | [Existing tables](0023-existing-table-model-auth-mapping.md) |
| Existing-table auth mapping | Explicit auth field/table configuration; never inferred | Accepted | [Existing tables](0023-existing-table-model-auth-mapping.md) |
| AI-assisted engineering | Cultivate: local MCP server, guidelines, and skills; implementation deferred | Accepted | [Cultivate](0013-first-party-ai-engineering-mcp.md) |
| Development debugger | Undergrowth: typed, correlation-driven local execution explorer | Accepted | [Undergrowth](0025-first-party-undergrowth-debugger.md) |

"Accepted in principle" means the manifesto establishes the architectural requirement, while the
observable programming contract remains to be specified.

## Decisions

1. [Use Hono as the initial private HTTP engine](0001-hono-http-engine.md) — Accepted on
   2026-07-10.
2. [Use PostgreSQL and Drizzle for persistence](0002-postgresql-drizzle-persistence.md) — Accepted
   on 2026-07-10.
3. [Build authentication as a first-party Canopy subsystem](0003-first-party-authentication.md) —
   Accepted on 2026-07-10.
4. [Provide a first-party CLI, installer, and generators](0004-first-party-cli-generators.md) —
   Accepted on 2026-07-10.
5. [Use Node.js 24 as the initial runtime](0005-node-24-runtime.md) — Accepted on 2026-07-10.
6. [Use Standard Schema with Zod 4 as the validation default](0006-standard-schema-zod-validation.md)
   — Accepted on 2026-07-10.
7. [Use the accepted MVP repository and testing toolchain](0007-mvp-toolchain.md) — Accepted on
   2026-07-10.
8. [Provide SendGrid email and Twilio SMS plugins in the MVP](0008-sendgrid-twilio-communications.md)
   — Accepted on 2026-07-10.
9. [Adopt the initial action, query, transaction, and lifecycle defaults](0009-operation-lifecycle-defaults.md)
   — Accepted on 2026-07-10.
10. [Use pg-boss for queueing and scheduling with at-least-once execution](0010-pg-boss-queue-scheduling.md)
    — Accepted on 2026-07-10.
11. [Use class-first OOP with a reflection-free, build-time-autowired container](0011-class-first-oop-container.md)
    — Accepted on 2026-07-10.
12. [Provide an Eloquent-style persistent model runtime](0012-eloquent-style-model-runtime.md) —
    Accepted on 2026-07-10.
13. [Build Cultivate as Canopy's first-party AI engineering product](0013-first-party-ai-engineering-mcp.md)
    — Accepted on 2026-07-10; implementation is deferred pending manifest and diagnostics
    stability.
14. [Compose explicit features into one generated application manifest](0014-explicit-features-generated-manifest.md)
    — Accepted for the MVP on 2026-07-10.
15. [Provide Laravel-like class events throughout the application](0015-laravel-like-class-events.md)
    — Accepted for the MVP on 2026-07-10.
16. [Keep source layout path-independent and autowire ordinary services](0016-path-independent-structure-autowired-services.md)
    — Accepted for the MVP on 2026-07-10.
17. [Use a runtime-owned deterministic lifecycle](0017-deterministic-runtime-lifecycle.md) —
    Accepted for the MVP on 2026-07-10.
18. [Provide one primary application-facing package](0018-public-package-surface.md) — Accepted for
    the MVP on 2026-07-10.
19. [Defer Canopy decorator syntax](0019-defer-decorator-syntax.md) — Deferred on 2026-07-10 until
    after the MVP programming model and compiler stabilize.
20. [Apply test overrides before boot](0020-preboot-test-overrides.md) — Accepted for the MVP on
    2026-07-10.
21. [Use injectable configuration classes](0021-injectable-configuration-classes.md) — Accepted for
    the MVP on 2026-07-10.
22. [Defer first-party roles and permission storage](0022-defer-first-party-permissions.md) —
    Deferred on 2026-07-10; default-deny policies and stable abilities remain core.
23. [Map models and authentication to existing tables](0023-existing-table-model-auth-mapping.md) —
    Accepted on 2026-07-10; implementation follows the MVP.
24. [Use role-scoped injection and plain constructor-injected services](0024-role-injection-with-plain-services.md)
    — Accepted for the MVP on 2026-07-11.
25. [Build Undergrowth as Canopy's first-party development debugger](0025-first-party-undergrowth-debugger.md)
    — Accepted on 2026-07-11.

## Adding a decision

Use the next four-digit sequence number and record:

1. Status and date.
2. The decision in one sentence.
3. The context and forces that make the choice consequential.
4. The boundary Canopy places around the technology.
5. Alternatives considered.
6. Positive and negative consequences.
7. Evidence required before acceptance, when proposed.
8. Conditions that would justify revisiting the decision.

Decisions should link to specifications once those specifications exist. Specifications define
behavior; decisions explain why a technology was chosen to implement it.

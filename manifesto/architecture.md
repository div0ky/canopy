# Canopy Architecture

This document develops the architectural consequences of the [Canopy Manifesto](index.md). It
describes the stable shape of the system without prematurely fixing every API or package boundary.

## The governing dependency rule

Dependencies point inward toward Canopy's application model:

```text
application features
        |
        v
Canopy programming model and contracts
        |
        v
Canopy adapters
        |
        v
infrastructure engines and vendor SDKs
```

Feature code may depend on domain code and Canopy contracts. Adapters may depend on both Canopy
contracts and their engine. Infrastructure engines must not appear in feature signatures, metadata,
exceptions, test assertions, or generated application contracts.

The rule is semantic as well as syntactic. Renaming an engine type behind a Canopy export does not
create a boundary if the engine still dictates application behavior.

## The kernel

The kernel owns the minimum machinery required to make the Canopy programming model true:

- Build and validate the application manifest.
- Register and resolve dependencies.
- Create application, request, and job execution scopes.
- Coordinate boot, readiness, drain, and shutdown.
- Dispatch actions, queries, events, listeners, and jobs.
- Establish execution context and propagate it across work.
- Expose inspection and test override surfaces.

The kernel should not become an open-ended module system. Features compose into one inspectable
application graph, and that graph should have deterministic ordering and diagnostics.

## The application manifest

Every supported declaration style should compile to one framework-owned manifest. Decorators,
builder functions, generated metadata, and future syntax are front ends; the manifest is the runtime
contract.

For the MVP, the application root explicitly selects class-first Features, and each Feature declares
its framework-facing classes through role arrays. Canopy automatically follows and wires the
concrete constructor dependencies beneath those declarations. This keeps composition visible without
requiring handwritten provider registration for every service. The accepted direction is defined in
[Explicit features and one generated manifest](decisions/0014-explicit-features-generated-manifest.md).

File and folder paths are source provenance, not application semantics. A class's owning Feature,
role, identity, and behavior must remain stable when its file moves. The accepted source-layout
rules are defined in
[Path-independent structure and autowired services](decisions/0016-path-independent-structure-autowired-services.md).

Feature classes are declaration-only and are never constructed or executed. Lifecycle behavior
belongs to provider and adapter classes whose dependencies and phases are represented in the
manifest; runtime hooks may not mutate the application graph after compilation.

The Application class is likewise declaration-only. It selects Features and other supported
composition metadata but is never constructed or executed. Boot creates a separate runtime object
that owns mutable lifecycle and execution state without changing the compiled application graph.

The manifest should make it possible to answer, before serving traffic:

- Which features, providers, routes, handlers, policies, observers, listeners, jobs, and schedules
  exist?
- Which bindings and scopes will each capability use?
- Which declarations conflict or are unreachable?
- Which infrastructure capabilities does the application require?
- Which startup and shutdown dependencies determine ordering?

This shared representation is the basis for boot validation, diagnostics, generators, API contracts,
test applications, and static analysis.

The compiler materializes that representation as canonical `.canopy/manifest.json` plus a
constructor-only `.canopy/registry.mjs`. Tools may read the JSON without executing application code.
The runtime uses the registry only to link manifest IDs to constructors, and it rejects artifacts
whose required build hashes do not match.

The compiled application graph is immutable. Runtime code cannot register or replace capabilities,
and development reload boots a newly compiled replacement runtime. Dynamic configuration and
business data influence declared behavior without redefining the manifest.

`.canopy/` is deterministic, gitignored build output. Development, tests, packaging, CLI inspection,
and Cultivate regenerate or require it; production bundles include it. Source control retains the
declarations and schemas from which the graph is derived, not the generated graph.

Compilation belongs to tooling. `Canopy.boot()` validates and consumes existing artifacts but never
analyzes TypeScript or generates the graph. Production runtime therefore has no compiler dependency
and fails actionably when required artifacts are unavailable or incompatible.

Every framework-facing declaration has an explicit stable ID. The compiler combines role, owning
Feature, and local ID into canonical identity. Paths, source locations, and class names are
provenance rather than identity, so moving or renaming code cannot silently break durable links.

The manifest format carries an independent version. Runtime and tooling consume only explicitly
supported versions and fail before interpretation when compatibility is unknown. Package versions
remain provenance and do not replace the manifest-format contract.

Manifest compilation fails closed. Only statically provable declarations and recognized helpers may
shape the application graph. Environment values remain runtime configuration; they cannot silently
add, remove, or reinterpret application capabilities after compilation.

Canonical artifact emission requires a semantically valid strict TypeScript application. The
compiler resolves actual program symbols and types; regexes, textual names, and syntax-only scans
cannot define manifest relationships. Last known-good artifacts may aid watch-mode diagnostics but
are stale and cannot boot as current source.

Each Canopy release pins the TypeScript version used by application checks and semantic manifest
compilation. TypeScript upgrades are framework compatibility changes backed by conformance suites,
not independent application dependency choices.

## Runtime lifecycle

The runtime owns one lifecycle: `start → ready → drain → stop → dispose`. Providers may implement
the optional `start()`, `drain()`, `stop()`, and `dispose()` phases. Readiness is a runtime state
reached only after manifest and configuration validation, pure construction, successful startup, and
required readiness checks.

Application code boots through `Canopy.boot(Application)`, which resolves only with a ready runtime,
and shuts down through idempotent `runtime.shutdown()`. Individual lifecycle transitions are not an
ordinary application control surface.

Drain ends admission before stop ends active behavior, and dispose then releases resources. Partial
startup never reaches readiness and unwinds every successfully started participant. The accepted
lifecycle direction is defined in
[Runtime-owned deterministic lifecycle](decisions/0017-deterministic-runtime-lifecycle.md).

Lifecycle ordering follows dependency edges only: dependencies start before their dependents and
shut down after them. Feature arrays, provider arrays, imports, files, and diagnostic sorting do not
create hidden ordering guarantees.

Startup and readiness failures trigger full unwind before boot rejects. The initiating failure
remains primary; stop, dispose, and cleanup-deadline failures remain attached and independently
observable rather than replacing the cause.

Every lifecycle hook receives a runtime-owned abort signal and deadline. Drain timeout advances to
forced stop, and all timeout diagnostics identify the participant and phase. The kernel does not
terminate the process; the host owns final process policy for non-cooperative code.

`Canopy.boot()` installs no process-global handlers. Official Node hosts translate termination
signals into idempotent runtime shutdown, own escalation and exit-code policy, and remove the
handlers they installed. Embedded hosts may provide equivalent integration themselves.

## Execution context

A request, scheduled invocation, console command, or dequeued job begins an execution context. The
context gives framework services a common view of identity and causality without turning it into a
global bag of arbitrary state.

Zero-registration concrete services and handler roots are transient. Execution-scoped and singleton
lifetimes require explicit manifest declarations. This prevents incidental mutable state from
becoming shared merely because a class was autowired.

Each admitted entry point owns one execution scope. Inline actions, queries, Units of Work,
observers, listeners, and services share it. Durable asynchronous work receives a fresh scope when
consumed and carries only explicitly serialized execution context across the boundary. Application
code cannot create arbitrary nested container scopes.

Concrete classes are their own injection identities. Abstract classes are the preferred ports for
application capabilities, while branded Canopy tokens with stable IDs represent values and cases
where a class is inappropriate. Raw strings, symbols, parameter names, and erased TypeScript
interfaces do not identify dependencies.

Dependencies are required by default. A parameter explicitly marked optional through TypeScript
syntax receives its valid binding when present or `undefined` when absent, and that optionality is
recorded in the manifest. Optionality never hides ambiguity, visibility, scope, cycle, or
construction failures.

Container-managed constructors are synchronous and side-effect-free. They may initialize local state
but cannot perform I/O, start active behavior, acquire asynchronous resources, register global
listeners, or mutate the graph. Those effects belong to explicit lifecycle phases so startup failure
can be unwound deterministically.

The initial context contract should account for:

- Actor and authentication state.
- Tenant or application partition.
- Correlation and causation identifiers.
- Trace linkage.
- Locale and time zone.
- Deadline, cancellation, and shutdown signals.
- The active dependency and unit-of-work scope.

Context propagation across process boundaries must be versioned and explicit. Sensitive fields must
not be serialized merely because they exist locally.

The proposed actor, authorization, and propagation contract is developed in
[Actor, Execution Context, and Authorization](specifications/actor-execution-context-authorization.md).

## Mutating work

An action is the primary boundary for an intentional state change. Unless a specification opts out
for a documented reason, action execution should:

1. Establish or join an execution context.
2. Validate input and authorize the operation.
3. Open a unit of work.
4. Load and mutate domain models.
5. Persist entity state using optimistic concurrency.
6. Append journal entries and outbox messages atomically with those state writes.
7. Commit the unit of work.
8. Release after-commit listeners and queued delivery.
9. Serialize the result at the transport boundary.

Observers need named phases. Code that runs before persistence, after persistence but before commit,
and after commit has materially different guarantees and must not share an ambiguous hook.

## Persistent model runtime

Canopy owns an Eloquent-like persistent model experience above its private database engine. Hydrated
models are attached to the active execution-scoped model session and unit of work. They may expose
`save()`, `delete()`, `refresh()`, dirty tracking, original values, changed values, and lifecycle
state without importing Drizzle or database records into domain code.

Model methods persist through registered mappers. An attached model's `save()` writes through the
active transaction, enforces optimistic concurrency, coordinates lifecycle observers, and stages
journal and outbox work. It does not commit the action transaction independently.

A detached model, a model used after its execution scope ends, or a model saved inside a read-only
query execution fails explicitly. Static model retrieval methods resolve the current model session
through Canopy's execution context; reporting and optimized reads may still use dedicated query
handlers and read models.

The accepted model-runtime decision is defined in
[Eloquent-style persistent models](decisions/0012-eloquent-style-model-runtime.md).

## Reads

Queries express reads and do not silently acquire mutation semantics. They may use repositories,
read models, or optimized query engines behind Canopy-owned contracts. Their authorization, context,
tracing, serialization, and error behavior should still align with actions.

Canopy need not force every read through hydrated domain models. It must make the distinction
between domain state and purpose-built projections clear.

## Application services and internal modules

Large application behavior may be decomposed into focused services, helpers, and internal modules
without creating new framework concepts. A concrete class reached from a declared Feature role's
`this.inject()` call, or through another service's constructor graph, is autowired automatically. It
requires no base class, decorator, provider entry, or Feature role-array registration.

Model methods retain entity invariants. Actions retain use-case and transaction coordination. Domain
and application services hold reusable rules and orchestration that would otherwise make those
classes unwieldy. Pure calculations may remain functions or value objects rather than
container-managed classes.

The dependency closure beneath a Feature is private by default. Cross-feature concrete service
dependencies and ambiguous ownership are build errors unless the owning Feature lists the concrete
class under `provides`. Features may expose concrete classes directly; abstract ports and typed
tokens are introduced only when polymorphism, replacement, isolation, or infrastructure boundaries
justify them. Consumers never import the providing Feature or trace module import/export chains.

Folder nesting is organizational only. An internal business area becomes a Feature when it needs
independent framework-facing behavior, lifecycle, configuration, or cross-feature capabilities; it
does not become one merely because it has many files.

## Configuration

Configuration is declared through typed classes owned by the Application or selected Features.
Canopy derives ordinary environment names and validation from group names, property names,
TypeScript types, optionality, defaults, and first-party semantic scalar types. Complex fields may
use Standard Schema without making schemas mandatory for common values.

The official Node host resolves explicit overrides, `process.env`, workspace-root `.env`, and
declared defaults in that order. Only declared keys are resolved. Validation completes before
singleton construction, and the runtime injects frozen configuration-group instances for direct
property access. Configuration classes do not execute application code, and resolved secrets never
enter the manifest or diagnostics.

## Durable side effects

Remote side effects do not occur inside a database transaction. Mutating work records durable intent
in the outbox, and a delivery runtime claims and dispatches that intent after commit.

Canopy's application-facing event experience is class-first and Laravel-like: a named event may be
dispatched from any framework-managed execution, and typed listener classes declare how they react.
`Event` represents general application dispatch. `DomainEvent` represents an accepted domain fact
that participates in the Unit of Work and journal. `Signal` remains immediate, non-durable framework
coordination. The accepted direction is defined in
[Laravel-like class events](decisions/0015-laravel-like-class-events.md). The initial executable
boundary is recorded in the
[class events vertical slice](implementation/class-events-vertical-slice.md).

The journal explains accepted domain changes. The outbox drives work that must leave the transaction
boundary. They may share metadata and atomic persistence, but they are not the same thing.

The initial executable job and worker boundary is recorded in the
[pg-boss queue and worker vertical slice](implementation/pg-boss-queue-worker-vertical-slice.md).

Listeners should declare whether they are local, after-commit, or queued. Delivery semantics, retry
behavior, idempotency expectations, and terminal failure must be observable.

## Transport adapters

HTTP is the first transport, with Hono as the initial private engine. Canopy routes, validation,
authentication, error documents, and resources compile into the Hono adapter. Application code may
use Web Standards `Request` and `Response` only through explicit escape hatches.

Other transports should reuse the application model rather than invent parallel models for actions,
authorization, validation, context, and errors.

The initial executable adapter boundary is recorded in the
[Hono HTTP vertical slice](implementation/hono-http-vertical-slice.md).

## Infrastructure adapters

An adapter owns:

- Translation between Canopy contracts and engine APIs.
- Configuration validation and secure defaults.
- Lifecycle integration and health reporting.
- Error normalization.
- Context and telemetry propagation.
- A framework fake or test strategy.
- A conformance suite shared by supported implementations.

Canopy may intentionally support one implementation of a contract. The contract exists to protect
the application model, not to promise a marketplace of interchangeable engines.

## Package boundaries

Application code uses one primary programming-model package, `@canopy/core`. Testing and
infrastructure adapters use separate public surfaces such as `@canopy/testing`, `@canopy/http-hono`,
and `@canopy/postgres-drizzle`. Compiler, registry, container, lifecycle, and runtime implementation
packages do not become application dependencies.

The MVP physically separates `@canopy/core`, `@canopy/manifest`, `@canopy/compiler`,
`@canopy/runtime`, `@canopy/testing`, and `@canopy/cli`. The package graph must preserve four
conceptual zones:

1. Kernel and programming model, with minimal infrastructure dependencies.
2. Public contracts used by features and adapters.
3. First-party adapters that bind contracts to selected engines.
4. Tooling and testing packages that consume the same manifest and lifecycle model.

Cycles between these zones are architectural defects. An adapter may extend Canopy; Canopy's kernel
must not require a concrete adapter in order to be understood or tested.

Runtime cannot depend on the compiler or TypeScript source analysis. Manifest remains a data-only
contract package. CI rejects cycles and forbidden dependency directions.

Each package exposes a closed export map. Deep imports, build-directory imports, and relative
imports across package boundaries are architectural defects. Shared internal concepts must become
intentional contracts rather than accidental coupling.

Test applications derive validated graphs through pre-boot overrides. They never mutate the
production manifest or a running container. Each test application owns isolated bindings, scopes,
fakes, records, and lifecycle state; focused services remain directly unit testable without a
container.

The accepted public surface is defined in
[One primary application-facing package](decisions/0018-public-package-surface.md).

## Architectural invariants

The specifications and conformance suites should protect these invariants:

- Feature code does not import private engine APIs.
- Boot either reaches a defined readiness state or disposes everything that started.
- Shutdown stops admission, drains accepted work, and disposes resources in deterministic order.
- A committed mutation cannot lose its durable journal and outbox records.
- Failed optimistic concurrency does not partially publish work.
- Context boundaries are explicit across asynchronous and process boundaries.
- All automatic behavior is attributable to a manifest declaration and lifecycle phase.
- Framework fakes preserve Canopy semantics rather than mimic vendor implementation details.

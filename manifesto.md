# The Canopy Manifesto

## Status

This document marks a reset.

The current Canopy codebase is abandoned as an implementation. It taught us what Canopy wants to
be, but its foundation makes NestJS the application kernel and leaves Canopy competing with the
framework underneath it. We will not incrementally extract the new design from that architecture.
The next Canopy repository will begin from specifications derived from this manifesto.

The ideas survive. The implementation does not constrain them.

## What Canopy is

Canopy is an opinionated application framework for TypeScript teams that want a coherent,
productive, Laravel-like developer experience without pretending JavaScript should become PHP or
rebuilding excellent infrastructure that already exists.

Canopy is best understood as a curated distribution.

A good mod pack does not rewrite every mod. It selects strong components, pins compatible
versions, integrates them, resolves their conflicts, supplies conventions, and makes the result
feel like one designed experience. Canopy will do the same for server-side TypeScript.

Canopy will combine excellent focused libraries for HTTP, persistence, queues, validation,
caching, storage, observability, and vendor integrations. It will own the application model that
connects them. Developers should experience one framework, one vocabulary, one lifecycle, and one
obvious way to perform ordinary work.

The value is not that Canopy authored every wheel. The value is that the wheels fit one chassis,
are tested together, and disappear beneath a coherent driving experience.

## Why Canopy must own the application model

Canopy originally treated NestJS as its runtime and composition kernel. That boundary is not
stable.

NestJS is not merely an HTTP engine. It has its own application graph, modules, dependency
injection container, lifecycle, controllers, providers, middleware, guards, pipes, interceptors,
exception filters, discovery model, and testing conventions. Those are precisely the surfaces
Canopy must control if it is to offer a cohesive developer experience.

Neither framework is wrong. They simply want authority over the same decisions.

Building Canopy on top of NestJS means translating Canopy concepts into NestJS concepts,
preserving NestJS escape hatches, and teaching developers where one framework stops and the other
begins. Over time, that makes Canopy a library collection with a branded facade rather than a
framework with a clear point of view.

Canopy will therefore own its application kernel. It will not build a general-purpose replacement
for NestJS. It will build only the small, opinionated kernel required by the Canopy programming
model and delegate focused technical work to focused libraries.

## Coherence over feature checklists

Canopy is inspired by what makes Laravel feel coherent, not by the goal of cloning every Laravel
API.

Framework coherence comes from:

- One unmistakable application lifecycle.
- One dominant way to express each common operation.
- Vocabulary that remains consistent across features.
- First-party capabilities designed as parts of one system.
- Defaults that work together without application-level assembly.
- Documentation that teaches an application model rather than a catalog of APIs.
- Escape hatches that exist without dominating everyday code.

Having a controller, container, ORM, validator, command runner, and queue package is not enough.
Those parts must agree about how an application is structured and how work flows through it.

Canopy will prefer fewer supported patterns with excellent integration over broad flexibility that
makes every application invent its own architecture.

## Our promise to developers

If a team subscribes to Canopy's opinions, Canopy should make application development feel almost
unfairly simple.

Developers should spend their design energy on their domain. They should not repeatedly assemble
HTTP middleware, transaction boundaries, validation, authorization, serialization, background
delivery, tracing, test fakes, and shutdown behavior.

Canopy should make the correct path the short path.

The framework may feel magical, but its behavior must remain explainable. Good magic removes
repetition while preserving a comprehensible execution model. Bad magic hides ordering, failure,
or state behind conventions that cannot be inspected.

Canopy will automate the tedious parts and make the consequential parts explicit.

## The framework boundary

Canopy owns:

- The application lifecycle.
- Application and feature composition.
- Dependency registration and resolution.
- Execution context and scoping.
- Actions, queries, and their dispatch.
- Domain models and persistence semantics.
- Transactions and units of work.
- Domain events, the journal, and the outbox.
- Listeners, observers, jobs, and schedules.
- The public HTTP programming model.
- Authentication and authorization integration.
- Validation behavior and error representation.
- Resources and response serialization.
- Configuration conventions.
- Testing APIs and framework fakes.
- The CLI, generators, diagnostics, and project structure.
- Compatibility between the curated components beneath it.

Canopy delegates:

- HTTP routing and request mechanics.
- Database drivers and query engines.
- Queue transport and distributed job mechanics.
- Schema validation algorithms.
- Cache and storage transports.
- WebSocket protocols and servers.
- Cryptography.
- Logging and telemetry transports.
- Vendor-specific API clients.

Delegation is deliberate. A delegated library is an implementation engine, not a second public
framework.

## Hono is the initial HTTP engine

Canopy will begin with Hono as its private HTTP routing and middleware engine, with the Hono Node
server adapter as the initial runtime implementation.

Hono is selected because it is focused, stable, fast, Web Standards-based, portable, testable
without opening a socket, and capable enough to keep Canopy out of low-level HTTP mechanics. It
does not require control over the entire application architecture.

Hono is not part of the public Canopy programming model.

Application and feature code must not depend on Hono contexts, exceptions, validators, middleware
types, RPC types, or route builders. Canopy will compile its own HTTP definitions into Hono
registrations through an adapter.

The foundational transport boundary is the Web Standards contract:

```ts
export interface HttpEngine {
  fetch(request: Request): Promise<Response>;
}
```

Canopy should remain intelligible if Hono is replaced tomorrow. An adapter conformance suite will
protect that boundary.

H3 remains a credible future engine. Its small, composable design and relationship with the UnJS
ecosystem align well with Canopy. We are not selecting it initially because Canopy should begin on
the more settled foundation, not because H3 is philosophically unsuitable. The adapter boundary
allows this decision to change without changing application code.

Nitro is not the Canopy kernel. Nitro is itself a server framework and build/deployment system. It
may eventually host a Canopy Web Standards handler, but Canopy will not adopt Nitro's application
model, routing conventions, plugin lifecycle, or configuration as its own foundation.

## Adapters are containment boundaries

Every major infrastructure dependency should sit behind a Canopy-owned contract when its native
API would otherwise shape application code.

An adapter is not ceremonial indirection. It gives Canopy four important properties:

1. Canopy controls the vocabulary developers use.
2. Compatibility and configuration live in one maintained place.
3. Infrastructure can be replaced without rewriting feature code.
4. Tests can use faithful framework fakes instead of mocking vendor internals.

Adapters must not become lowest-common-denominator abstractions. Canopy should expose the
capabilities its programming model promises and choose infrastructure that implements them well.
We do not need interchangeable implementations merely for the appearance of flexibility.

Where developers need an escape hatch, prefer durable standards and Canopy contracts. For HTTP,
that means `Request` and `Response`, not a Hono context. Escape hatches should be intentional,
visible, and uncommon.

## A curated compatibility contract

A Canopy release represents a tested combination of framework behavior and infrastructure
versions.

Canopy will:

- Select foundational dependencies intentionally.
- Pin their versions rather than outsource compatibility to each application.
- Configure secure and production-ready defaults.
- Maintain integration and adapter conformance tests.
- Test boot, normal operation, failure, retry, and shutdown behavior across the stack.
- Upgrade dependencies through deliberate Canopy releases.
- Describe behavior changes rather than merely list dependency bumps.
- Provide one supported path before providing multiple optional paths.

Applications should upgrade Canopy, not independently solve a compatibility matrix across a dozen
runtime packages.

Internal use makes this discipline more important, not less. Canopy should let internal teams move
quickly because the platform team has already made and verified the infrastructure decisions. If
Canopy is later open sourced, this compatibility contract becomes part of the product rather than
an internal assumption that must be reconstructed.

## The desired programming experience

The final syntax will be specified separately, but the experience should approach this level of
simplicity:

```ts
const app = Canopy.create({
  features: [Orders, Customers, Billing],
  infrastructure,
});

await app.serve();
```

A feature should describe its capabilities without exposing infrastructure composition:

```ts
export const Orders = feature({
  providers: [OrderStore, bind(OrderPersistence).to(PrismaOrderPersistence)],
  actions: [CreateOrder, UpdateOrder],
  queries: [GetOrder, ListOrders],
  observers: [OrderObserver],
  listeners: [SendOrderCreatedNotification],
  http: [OrdersController],
});
```

An HTTP endpoint should express application intent rather than HTTP plumbing:

```ts
@HttpController('/orders')
@Authenticated()
export class OrdersController {
  public constructor(
    private readonly actions: ActionBus,
    private readonly queries: QueryBus,
  ) {}

  @Post('/')
  public create(@Body(CreateOrderRequest) input: CreateOrderInput): Promise<OrderResource> {
    return this.actions.execute(new CreateOrder(input));
  }
}
```

Decorators are not yet a foregone conclusion. A declarative non-decorator API may offer better
type inference, tooling, and portability. Both styles may compile to the same application manifest.
The specification must select a primary style based on clarity and capability, not familiarity
alone.

Testing should feel like testing the application, not reconstructing its internals:

```ts
const app = await CanopyTest.create({ features: [Orders] })
  .fake(Notifications)
  .fake(Broadcasting)
  .boot();

const response = await app.post('/orders', input).actingAs(user);

response.assertCreated();
Notifications.assertSent(OrderCreatedNotification);
```

## What Canopy should make automatic

Subject to the specifications, Canopy should be able to:

- Build an application manifest from its features.
- Resolve dependencies and validate the dependency graph at boot.
- Start and stop infrastructure in deterministic order.
- Establish request and job execution context.
- Propagate actor, correlation, causation, locale, and trace metadata.
- Validate request inputs and return stable error documents.
- Invoke authentication and authorization policies.
- Open transactions for mutating application operations.
- Persist model snapshots with optimistic concurrency.
- Append journal and outbox records atomically.
- Run model lifecycle observers at defined phases.
- Dispatch local and queued event listeners at the correct time.
- Serialize resources consistently.
- Enqueue jobs with retry, timeout, uniqueness, and context conventions.
- Reconcile schedules at boot.
- Produce useful logs, traces, and reports without per-feature wiring.
- Generate API contracts and developer documentation.
- Replace framework services with fakes in tests.
- Shut down gracefully when startup partially fails or the process receives a signal.

Every automatic behavior must have a documented phase in the application lifecycle and an
observable failure mode.

## The application kernel should remain small

Owning the kernel does not grant permission to recreate NestJS.

Canopy needs a focused container and lifecycle, not a general-purpose module metaframework. It
should support the dependency patterns the Canopy programming model actually requires:

- Values.
- Factories.
- Classes.
- Aliases or tokens where TypeScript types do not survive at runtime.
- Application singletons.
- Request and job execution scopes.
- Test overrides.
- Deterministic disposal.
- Excellent cycle and missing-binding diagnostics.

Features should compose directly. We should avoid a system in which modules import modules to
export providers to modules that indirectly expose them elsewhere. The application graph should
be inspectable, deterministic, and easy for tooling to explain.

We will add extension mechanisms in response to demonstrated application needs, not imagined
framework completeness.

## Opinionated means saying no

Canopy will not optimize for every TypeScript team.

Canopy will choose:

- A preferred project structure.
- A preferred way to model commands and reads.
- A preferred transaction boundary.
- A preferred event delivery model.
- A preferred validation and error shape.
- A preferred testing vocabulary.
- A preferred queue and scheduling model.
- A preferred way to represent infrastructure ports.
- A preferred path for common production concerns.

Teams that reject these opinions may be better served by focused libraries or a more configurable
framework. That is healthy. Canopy succeeds by making its chosen path exceptional, not by making
every path possible.

## Non-goals

Canopy is not:

- A reimplementation of NestJS.
- A wrapper that renames every method from its dependencies.
- A generic dependency injection container project.
- A generic HTTP framework.
- An ORM written from scratch.
- A queue transport written from scratch.
- A universal compatibility layer for arbitrary infrastructure choices.
- A Laravel syntax clone.
- A collection of unrelated packages marketed under one name.
- An excuse to hide consequential domain behavior.

Canopy will not compete on the number of replaceable components. It will compete on how little
application developers must think about components that should already work together.

## Standards for framework magic

Framework magic is acceptable when it meets all of these standards:

1. It removes recurring application-level tedium.
2. It behaves deterministically.
3. Its lifecycle phase is documented.
4. It can be inspected through tooling or diagnostics.
5. Its failures point to the application concept the developer understands.
6. It can be replaced or overridden in tests through Canopy APIs.
7. It does not require application code to understand the hidden engine.

If a behavior cannot meet those standards, prefer explicit code.

## Success criteria

Canopy is succeeding when:

- A new developer can trace a request from route to durable side effects without learning the
  internals of Hono, Prisma, BullMQ, or Redis.
- A feature reads primarily as domain vocabulary and application intent.
- The normal implementation path is short, safe, and consistent.
- Cross-cutting behavior is configured once and applied predictably.
- Tests express application behavior using Canopy-owned fakes and assertions.
- Framework diagnostics explain the resolved application graph and lifecycle.
- Infrastructure upgrades are absorbed and verified by Canopy rather than every application.
- An adapter can be replaced without changing feature code.
- Escape hatches remain available but rarely necessary.
- The documentation feels like one book written for one system.

## The next repository

The next Canopy repository should begin with specifications, not implementation momentum.

The initial specification set should define:

1. The application and feature model.
2. The application lifecycle and failure semantics.
3. The dependency container and execution scopes.
4. The HTTP manifest and Hono adapter boundary.
5. Actions, queries, and handler dispatch.
6. Domain models, repositories, and units of work.
7. Journal, outbox, events, listeners, and observers.
8. Jobs, retries, uniqueness, schedules, and worker lifecycle.
9. Authentication, authorization, and execution context.
10. Resources, validation, and error documents.
11. Testing applications, fakes, and assertions.
12. Configuration, observability, diagnostics, and CLI behavior.
13. Adapter contracts and the compatibility test suite.
14. Package boundaries and dependency rules.

Each specification should answer:

- What does the application developer write?
- What does Canopy guarantee?
- Which lifecycle phase owns the behavior?
- How does failure behave?
- How is it tested?
- What is the escape hatch?
- Which implementation dependency performs the underlying work?
- How is that dependency prevented from leaking into feature code?

## Closing conviction

Canopy should feel like a framework, not like a pile of libraries and not like a facade over
another application framework.

It will earn that coherence by being decisive above the infrastructure boundary and humble below
it: opinionated about the developer experience, rigorous about compatibility, and eager to rely on
excellent focused tools.

We are not rebuilding the ecosystem.

We are making the ecosystem feel like one thing.

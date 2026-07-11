# 0011: Use Class-First OOP with a Reflection-Free Container

- **Status:** Accepted
- **Accepted:** 2026-07-10
- **Decision owners:** Doxa maintainers

## Decision

Doxa's primary programming model is class-first and object-oriented. Applications are composed
through an explicit generated manifest. The runtime dependency container is first-party,
reflection-free, and driven by a dependency graph produced at build time.

## Class-first application model

The following application concepts should primarily be classes:

- Domain models and value objects.
- Actions and queries.
- Policies.
- Observers and listeners.
- Jobs and schedules.
- Console commands.
- Infrastructure adapters and application services.

Class-first Feature declarations and small declarative binding helpers compose these objects. They
do not replace behavior-bearing classes with configuration or closure-based service graphs.

Decorators are not supported as Doxa declaration syntax in the MVP. An optional decorator frontend
is deferred and may be reconsidered only if it compiles into the identical manifest. Doxa does not
depend on legacy decorator metadata or runtime type reflection.

## Role classes and capability traits

A framework-facing class declares its primary role through a Doxa base class and implements the
role's intention-revealing handler. Jobs, actions, queries, listeners, observers, policies, and
other roles should read as application concepts rather than container registrations.

Orthogonal framework semantics may be declared through a small set of compiler-recognized TypeScript
capability interfaces. For example:

```ts
export class SendWelcomeEmail extends Listener<UserRegistered> implements ShouldQueue {
  async handle(event: UserRegistered): Promise<void> {
    // ...
  }
}
```

The Doxa compiler resolves the explicit `implements` clause and records the capability in the
application manifest. Runtime behavior follows the manifest; it does not require the TypeScript
interface to survive JavaScript emission.

Base classes define primary roles. Capability interfaces modify categorical execution semantics such
as queued delivery, uniqueness, or future broadcasting. Values such as queue name, retry limit,
timeout, and backoff belong in typed class configuration. Doxa must keep capability interfaces few,
orthogonal, and semantically precise rather than creating marker-interface soup.

Doxa will follow Laravel's established distinction for queueing and broadcasting vocabulary and
semantics:

- `ShouldQueue` marks work such as a listener for asynchronous queue execution.
- `ShouldQueueAfterCommit` includes `ShouldQueue` semantics and requires enqueueing to wait until
  the active transaction commits. If no transaction is active, dispatch proceeds immediately.
- `ShouldBroadcast` marks an event for queued broadcasting.
- `ShouldBroadcastNow` marks an event for synchronous broadcasting in the current process.
- `dispatch()` submits a job to the queue; `dispatchSync()` executes it synchronously in the current
  process and does not enqueue it.

`ShouldQueueNow` is not part of the Doxa contract. Transaction timing is separate from execution
mode. In an active Doxa unit of work, ordinary queued delivery remains outbox-backed and becomes
eligible after commit by default, making `ShouldQueueAfterCommit` an explicit guarantee rather than
a requirement for ordinary safety. A synchronous operation executes in the current process and
receives the documented semantics of that execution phase. Broadcasting remains deferred from the
MVP, but these names reserve its eventual programming model.

## Dependency injection

Ordinary application services use constructor injection. Framework-facing role classes use the
inherited, execution-scoped `this.inject()` API and do not declare constructors during normal
authoring. This distinction is defined by
[decision 0024](0024-role-injection-with-plain-services.md).

The build-time compiler inspects both constructor parameters and statically declared role injections
to generate dependency metadata. Abstract ports, values, aliases, and factories require explicit
bindings because TypeScript interfaces do not exist at runtime and application intent should remain
visible.

The generated graph must be inspectable before boot and must identify missing bindings, ambiguous
bindings, invalid scopes, and dependency cycles using application vocabulary.

## Injection identities

Concrete classes are their own injection identities. Abstract classes are the preferred application
and domain ports because they provide clean constructor types and survive JavaScript emission as
runtime-representable identities:

```ts
export abstract class PaymentGateway {
  abstract charge(payment: Payment): Promise<Receipt>
}

export class CheckoutService {
  constructor(private readonly payments: PaymentGateway) {}
}
```

```ts
bindings = [bind(PaymentGateway).to(StripePaymentGateway)]
```

When an abstract class is inappropriate, Doxa provides a branded typed token with an explicit stable
ID:

```ts
export const CheckoutTimeout = token<Duration>('checkout-timeout')
```

Raw strings, raw symbols, constructor parameter names, and erased TypeScript interfaces are not
valid injection identities. Compiler capability interfaces such as `ShouldQueue` describe class
semantics and are never container tokens. Missing, duplicate, or competing bindings fail compilation
with their source locations and dependency paths.

## Optional dependencies

Constructor dependencies are required by default. A developer may make a dependency explicitly
optional through native TypeScript syntax:

```ts
export class CheckoutService {
  constructor(private readonly cache?: CheckoutCache) {}
}
```

The compiler records the dependency as optional in the manifest. If one valid, visible, scope-safe
binding exists, Doxa injects it. If no binding exists, Doxa injects `undefined`. Optionality does
not suppress competing-binding, private-visibility, invalid-scope, cycle, or construction failures;
those remain errors.

Required parameters still fail compilation when unresolved. Optionality applies only to the
parameter that declares it and does not propagate through its dependency graph.

A null-object implementation is appropriate only when disabled behavior is a meaningful polymorphic
domain choice. Applications must not create null objects merely to satisfy the container when
absence is the honest model.

## Container scopes

The MVP container supports:

- `singleton` — one instance for the application lifetime.
- `execution` — one instance for a single admitted framework execution.
- `transient` — a new instance for each resolution.

Concrete constructor dependencies use `transient` scope by default. Actions, queries, listeners,
jobs, and other handler roots receive a fresh instance for each dispatch. Longer-lived state must be
explicit in the manifest:

- Unit of Work, Model Session, and similar contextual services are explicitly execution-scoped.
- Database pools, infrastructure clients, and other application resources are explicitly singleton.
- Models are hydrated and attached by the Model Session; they are not container-resolved services.

The compiler must reject a singleton that directly or transitively depends on an execution-scoped
service. Explicit scopes may not be inferred from mutable fields, naming conventions, or usage
patterns.

HTTP requests, dequeued jobs, schedule firings, console commands, WebSocket messages, and future
admitted entry points each create a distinct execution scope. Those scopes have identical
resolution, context, disposal, and diagnostic semantics.

One admitted entry point owns exactly one execution scope. Actions, queries, model operations, Units
of Work, policies, observers, local listeners, after-commit listeners, and their resolved services
reuse that scope. An action may activate a Unit of Work inside the scope; the Unit of Work does not
define a second dependency scope.

Durable asynchronous delivery creates a new execution scope when a worker consumes the work. Jobs
and queued listeners receive serialized actor, initiator, tenant, correlation, causation, trace, and
other permitted execution-context values. They never receive parent scoped instances.

Applications cannot create arbitrary nested dependency scopes. Every execution scope disposes its
resources after success, failure, timeout, cancellation, or shutdown. Admission, context creation,
and disposal rules are identical across all entry-point types.

## Feature visibility

Providers are private to their feature by default. Cross-feature dependencies use explicitly
declared capabilities or ports in the application manifest. Features do not form Nest-style chains
of module imports that re-export providers indirectly.

The final visibility syntax remains specification work, but it must keep ownership and dependency
direction visible to tooling.

## Lifecycle and disposal

The container owns deterministic construction and disposal ordering. Execution-scoped resources are
disposed when their execution ends, including success, failure, timeout, cancellation, or shutdown.
Singleton resources are disposed in reverse dependency order during application shutdown or
partial-startup rollback.

Async factories and disposable resources must declare their lifecycle explicitly in the manifest.

## Side-effect-free construction

All container-managed constructors must be synchronous and side-effect-free. A constructor may store
dependencies, validate local arguments, and initialize in-memory state. It must not:

- Perform database, network, filesystem, or remote-configuration I/O.
- Start timers, workers, polling loops, or asynchronous tasks.
- Register process-global or framework-global listeners.
- Acquire resources that require asynchronous cleanup.
- Mutate the application graph or resolve additional dependencies imperatively.

Resource acquisition and active behavior belong to explicit, manifest-visible lifecycle phases. The
compiler cannot prove every possible constructor side effect, so conformance tests, generated code,
documentation, and framework diagnostics must reinforce this contract. Framework-owned providers and
adapters must uphold it without exception.

When construction or startup fails, Doxa unwinds only lifecycle work it can identify. Hidden
constructor effects are therefore contract violations even if they appear locally convenient.

## Consequences

- Doxa provides Laravel-like scoped role injection and conventional service constructor injection
  without PHP-style runtime reflection.
- Build-time manifest generation becomes part of the required framework toolchain.
- Application boot validates a known graph rather than discovering dependencies opportunistically.
- Interfaces used as ports need runtime-representable tokens or abstract classes and explicit
  bindings.
- The container remains an implementation mechanism, not the public center of the framework.

## Required implementation proof

The MVP must prove:

1. Concrete class autowiring without decorators or handwritten dependency arrays.
2. A role class and compiler-recognized capability interface compile into the expected manifest
   semantics without runtime reflection.
3. Explicit binding and replacement of an abstract persistence port.
4. Typed token injection for a primitive or value that cannot use an abstract-class port.
5. Raw strings, symbols, parameter names, and erased interfaces fail as injection identities.
6. Required unresolved dependencies fail compilation.
7. Optional unbound dependencies inject `undefined` and remain explicit in the manifest.
8. Optional bound dependencies retain visibility, ambiguity, scope, cycle, and construction
   validation.
9. Feature-private provider isolation and intentional cross-feature capabilities.
10. Singleton, execution, and transient scope correctness.
11. Zero-registration concrete services and handler roots resolve as transient.
12. Singleton-to-execution dependency paths fail compilation with the complete dependency path.
13. Identical execution-scope behavior for HTTP, jobs, schedules, console commands, and listeners.
14. Actions, Units of Work, observers, and inline listeners share the admitting execution scope.
15. Queued delivery creates a fresh execution scope without transferring scoped instances.
16. Arbitrary nested scope creation is unavailable to application code.
17. Framework-owned constructors perform no I/O or active background behavior.
18. Resource acquisition occurs only through manifest-visible lifecycle phases.
19. Deterministic disposal after success, failure, timeout, cancellation, and partial startup.
20. Actionable missing-binding, ambiguity, scope-leak, and cycle diagnostics.
21. Test overrides through Doxa APIs without a service locator.

## Revisit when

- Build-time TypeScript analysis cannot produce reliable dependency metadata.
- Class autowiring requires runtime behavior that cannot be made deterministic or inspectable.
- Feature visibility rules recreate module import/export complexity under different names.
- A required application pattern cannot fit the three accepted scopes without hidden lifetime
  behavior.

## References

- [Doxa Manifesto: Object-oriented by conviction](../index.md#object-oriented-by-conviction)
- [Doxa Architecture: application manifest](../architecture.md#the-application-manifest)
- [Runtime-owned deterministic lifecycle](0017-deterministic-runtime-lifecycle.md)
- [Doxa actor and execution-context specification](../specifications/actor-execution-context-authorization.md)

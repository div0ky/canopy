# Actor, Execution Context, and Authorization

- **Status:** Accepted
- **Accepted:** 2026-07-10
- **Depends on:** First-party authentication, application lifecycle, execution scopes

## Recommendation

Doxa should define one actor model and one immutable execution context for every kind of work.
Authentication mechanisms produce normalized identities. The Doxa actor resolver turns identity,
tenant, delegation, and impersonation evidence into an actor. Authorization policies evaluate that
actor. The execution context carries the resulting identity and causal metadata through the
application.

The same contract should govern HTTP requests, actions, queries, listeners, jobs, schedules, console
commands, WebSockets, and future transports.

`Actor` should be the backbone of Doxa's authorization, observability, audit, journal, and testing
models—not a user object attached to HTTP requests.

## Vocabulary

### Identity

An identity is a durable Doxa record representing a subject that has successfully presented one or
more credentials. Authentication establishes identity. Identity does not by itself determine tenant,
delegation, impersonation, or domain permission.

### Actor

An actor is the principal whose authority is used for the current operation. It is an immutable,
minimal reference rather than a loaded domain model or authentication-session object.

The initial actor kinds should be:

- `anonymous` — no authenticated principal.
- `user` — a person represented by a Doxa identity and application actor record.
- `service` — a machine or integration with explicitly granted authority.
- `system` — trusted framework work with a named, narrowly defined purpose.

Actor kinds are not roles. Roles, memberships, ownership, and permissions are application facts
evaluated by authorization policies.

Doxa's first-party storage and management model for those facts is intentionally deferred by
[Decision 0022](../decisions/0022-defer-first-party-permissions.md). Applications may load them from
existing tables or services without bypassing the common policy decision and audit path.

### Initiator

The initiator is the actor that originally caused a chain of work. In synchronous user work, the
actor and initiator are usually the same. A worker processing a delayed job may be the current actor
while the user who caused the job remains the initiator.

### Delegation

Delegation records an intentional transfer of authority, including impersonation. It is represented
as a chain of hops rather than overwriting the original actor.

Every hop must identify:

- The delegating actor.
- The effective actor.
- The reason or grant identifier.
- When the delegation began and, when applicable, expires.

### Execution

An execution is one admitted unit of work such as an HTTP request, dequeued job, schedule firing, or
console invocation. Each execution has its own ID and resource scope.

### Correlation and causation

Correlation groups a complete business flow. Causation points to the operation or durable message
that directly caused the current execution. Correlation answers "which story is this part of?";
causation answers "what immediately led here?"

## Actor contract

The public contract should resemble:

```ts
export type ActorKind = 'anonymous' | 'user' | 'service' | 'system'

export interface ActorRef {
  readonly kind: ActorKind
  readonly id?: ActorId
}

export interface DelegationHop {
  readonly from: ActorRef
  readonly to: ActorRef
  readonly grantId: string
  readonly reason: string
  readonly expiresAt?: Date
}
```

An anonymous actor has no durable ID by default. Doxa should not manufacture a pseudonymous user
identifier merely to make anonymous traffic easier to correlate.

Actor references must use opaque internal identifiers. Email addresses, usernames, provider claims,
session tokens, and loaded user records do not belong in `ActorRef`.

## Execution context contract

The public contract should resemble:

```ts
export interface ExecutionContext {
  readonly executionId: ExecutionId
  readonly correlationId: CorrelationId
  readonly causationId?: CausationId

  readonly actor: ActorRef
  readonly initiator: ActorRef
  readonly delegation: readonly DelegationHop[]
  readonly tenant?: TenantRef

  readonly authentication: AuthenticationContext
  readonly transport: TransportContext
  readonly trace: TraceContext

  readonly locale?: string
  readonly timeZone?: string
  readonly deadline?: Date
  readonly cancellation: AbortSignal
}
```

The context must be immutable. Deriving a child context creates a new value and validates any change
to actor, tenant, delegation, deadline, or propagation policy.

The context is not a general key-value bag. Features must not attach arbitrary mutable state to it.
New cross-cutting fields require a framework contract and propagation rules.

## Authentication context

Authentication metadata should record how the current identity was established without exposing
credentials:

```ts
export interface AuthenticationContext {
  readonly state: 'anonymous' | 'authenticated'
  readonly identityId?: IdentityId
  readonly method?: string
  readonly assurance?: 'single-factor' | 'multi-factor' | 'phishing-resistant'
  readonly authenticatedAt?: Date
  readonly sessionId?: SessionId
}
```

The method is a stable Doxa identifier such as `password` or `passkey`, not a plugin-specific type.
Session IDs are local diagnostic references and must not be serialized into jobs, events, or
external trace baggage.

## Context creation

Every entry adapter creates or resumes a context before application code runs:

- The Hono adapter validates incoming trace headers, authenticates the request, resolves tenant and
  actor, and creates an HTTP execution.
- A worker validates a versioned context envelope from the job and creates a new job execution.
- A scheduler creates a system-initiated execution for each schedule firing.
- The CLI creates a console execution and explicitly decides whether the command is anonymous,
  local-user initiated, service authenticated, or system work.
- A WebSocket adapter authenticates the connection but creates a fresh execution for each admitted
  message.

Adapters may reject invalid or untrusted propagated context. Incoming correlation, trace,
delegation, and actor data are evidence to validate, not authority to accept blindly.

## In-process propagation

On Node.js 24, the kernel should use `AsyncLocalStorage` as the private carrier for the active
immutable context and execution scope. Framework services such as logging, tracing, repositories,
and the unit of work can read that carrier without application code forwarding context manually.

This is an implementation detail, not the public programming model:

- Application APIs receive explicit actors or use Doxa-owned context accessors.
- Domain models do not import `AsyncLocalStorage`.
- Async work that outlives an execution must be admitted as a new execution rather than retaining a
  stale in-process store.
- Tests must detect work accidentally escaping its execution scope.

## Cross-process propagation

Cross-process work uses a versioned Doxa context envelope. The portable envelope should contain
only:

- Correlation and causation identifiers.
- Trace linkage.
- Actor and initiator opaque references.
- A validated delegation chain when the work is intentionally delegated.
- Tenant reference.
- Locale and time zone when relevant.

It must not contain:

- Session tokens or credential material.
- Passwords, API keys, or authorization headers.
- Email addresses, names, or raw identity-provider claims.
- Arbitrary OpenTelemetry baggage.
- Loaded roles, permissions, or a snapshot of authorization results.

The envelope is stored with journal entries, outbox records, and jobs. It is not copied into calls
to untrusted external services by default.

## Asynchronous authority

A job does not automatically inherit the original user's authority merely because that user caused
it.

The default model should be:

- The worker or named system capability is the current actor.
- The original actor remains the initiator for attribution.
- The original correlation ID is preserved.
- The message or event ID becomes causation.
- Authorization uses the worker's explicit capability and current application state.

A job that truly needs delegated user authority must declare that requirement, carry a validated
delegation grant, and re-evaluate the grant when it executes. A serialized session or prior
authorization result is never sufficient.

Retries create a new execution ID and span while preserving correlation, causation, actor,
initiator, and job identity. Retry attempt is execution metadata, not a new business cause.

Each execution span preserves its inbound parent span when one exists. Framework-owned timed work
creates child spans beneath the currently active span. Fan-out, delayed work, retries, and
multi-source work use bounded explicit span links when a single parent would misrepresent causality.
Business causation remains distinct from trace parentage.

## Authorization contract

Authorization should be default-deny and return a structured decision rather than a bare boolean:

```ts
export interface PolicyRequest<Resource = unknown> {
  readonly actor: ActorRef
  readonly ability: string
  readonly resource?: Resource
  readonly tenant?: TenantRef
  readonly context: ExecutionContext
}

export interface PolicyDecision {
  readonly effect: 'allow' | 'deny'
  readonly policy: string
  readonly code: string
}
```

The stable `code` explains the decision to tests, diagnostics, and security audit records without
exposing sensitive reasoning to the caller.

Doxa should support two policy phases:

1. Entry policies run before dispatch for abilities that do not require a loaded resource.
2. Resource policies run after the resource is loaded, within the action or query execution scope.

Transport annotations such as `@Authenticated()` or `@Authorize('orders.create')` compile into the
same manifest and policy pipeline used outside HTTP. Controllers do not implement a second
authorization model.

## Observability contract

Doxa should automatically attach the following low-level fields where the sink permits them:

```text
doxa.execution.id
doxa.correlation.id
doxa.causation.id
doxa.actor.kind
doxa.actor.id
doxa.initiator.kind
doxa.initiator.id
doxa.tenant.id
doxa.auth.method
doxa.transport.kind
doxa.policy.name
doxa.policy.effect
doxa.policy.code
```

These fields should connect logs, spans, security audits, journal entries, outbox records, jobs, and
domain-failure reports.

Actor and tenant IDs are high-cardinality and potentially linkable identifiers. They may appear in
access-controlled logs, traces, and audit records according to policy, but must not become metric
labels. Doxa should support pseudonymization and field suppression per telemetry sink.

OpenTelemetry trace context should remain standards-compatible. Actor, tenant, session, and
authorization data should not be placed into automatically propagated baggage; baggage has no
built-in integrity protection and can reach unintended downstream services.

## Journal and outbox metadata

Every committed journal and outbox record should capture a durable context envelope in the same
transaction as the entity-state writes and message payload.

The durable record must make it possible to answer:

- Which actor performed the accepted operation?
- Who initiated the broader chain?
- Under which tenant and delegation grant did it execute?
- Which request, action, event, or job directly caused it?
- Which correlation and trace connect it to surrounding work?

Historical records retain the actor references and decision metadata accepted at the time. They do
not dynamically reinterpret history when a user, membership, or policy later changes.

## Failure behavior

- Missing required authentication produces a stable unauthenticated error.
- Failed authorization produces a stable forbidden error externally and a structured policy decision
  internally.
- Invalid propagated actor, delegation, tenant, or causal metadata rejects the execution before
  feature code runs.
- Context loss inside an admitted execution is a framework fault and must be surfaced by diagnostics
  rather than silently replaced with a system actor.
- A missing actor on a durable mutation is invalid; the system must always name the actor kind and
  initiator semantics explicitly.

## Testing API

The first-party test application should support:

```ts
const app = await DoxaTest.create({ features: [Orders] }).boot()

await app.actingAs(user).post('/orders', input)
await app.asService(importer).dispatch(new ImportOrders())
await app.impersonating(user, { as: admin, reason: 'support-case-42' })

app.authorization.assertAllowed('orders.create')
app.authorization.assertDenied('orders.delete', 'orders.owner_required')
app.context.assertCorrelationPreserved()
app.context.assertInitiatedBy(user)
```

Tests must also be able to assert the durable actor, initiator, correlation, causation, delegation,
and policy metadata written to journal and outbox records.

## Diagnostics

Doxa diagnostics should be able to explain:

- How an identity became the current actor.
- Which tenant and delegation rules were applied.
- Which policy evaluated an ability and which stable code it returned.
- Where context was created, derived, serialized, and resumed.
- Whether a log, trace, journal entry, outbox record, or job is missing required causal metadata.
- Which telemetry fields were suppressed or pseudonymized by sink policy.

Diagnostics must never print credential material, bearer tokens, password hashes, raw session
tokens, or unredacted identity-provider claims.

## Conformance scenarios

The contract is ready for acceptance when tests prove:

1. Actor and tenant isolation across concurrent requests.
2. Identity-to-actor resolution for anonymous and password-authenticated requests.
3. Default-deny entry and resource policy behavior.
4. Impersonation preserves both initiator and effective actor.
5. Journal and outbox writes receive atomic causal metadata.
6. Jobs preserve attribution without inheriting stale session authority.
7. Retries preserve business causality while creating new executions and spans.
8. Invalid propagated context is rejected before feature code.
9. Logs and traces correlate without putting sensitive identity data into baggage or metrics.
10. Context is disposed after success, failure, timeout, cancellation, and shutdown.
11. Test helpers exercise the same resolution and policy paths as production adapters.

## Accepted design decisions

### Use distinct actor records

A user actor should reference an authentication identity rather than reuse its ID. Distinct actor
records give users, services, systems, and future delegated principals one durable namespace while
allowing credentials and identity providers to change independently.

### Select tenant after actor resolution

Authentication should resolve identity and actor first. Tenant selection should then validate a
requested or default tenant through a separate policy phase. An identity may belong to several
tenants, and authentication alone must not choose authority accidentally.

### Persist delegation grants

Delegation and impersonation should use durable, revocable, scoped, expiring grant records. Only the
opaque grant ID and actor references should cross a process boundary; the receiver reloads and
revalidates the grant before accepting delegated authority.

### Separate audit identity from general telemetry identity

Security audits, journal entries, and outbox records should retain the opaque internal actor ID.
General logs and traces should pseudonymize actor and tenant IDs per telemetry sink by default.
Metrics must never use actor, identity, session, or tenant IDs as labels.

### Keep policy decisions simple in v1

The first policy contract should return allow or deny, the evaluating policy, and a stable reason
code. It should not implement obligations or attribute-mutation responses until a demonstrated use
case cannot be expressed through actions, policies, and resources.

## References

- [First-party authentication decision](../decisions/0003-first-party-authentication.md)
- [Doxa Architecture: execution context](../architecture.md#execution-context)
- [OpenTelemetry context propagation](https://opentelemetry.io/docs/concepts/context-propagation/)
- [OpenTelemetry baggage security](https://opentelemetry.io/docs/concepts/signals/baggage/)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)

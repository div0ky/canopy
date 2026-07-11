# Execution and Operations Vertical Slice

- **Status:** Implemented proof
- **Implemented:** 2026-07-10
- **MVP status:** Incomplete
- **Depends on:** [Foundation vertical slice](foundation-vertical-slice.md)

## Outcome

The second Doxa implementation proves this path end to end:

```text
entry adapter admits immutable execution context
  → runtime creates one execution scope
  → ActionBus or QueryBus selects a manifest-declared handler
  → constructor dependencies resolve inside the current scope
  → action enters the transaction boundary; query does not
  → handler returns or fails
  → execution-scoped and disposable transient objects unwind
```

The reference transaction provider proves transaction entry, commit, rollback, and causal context
semantics. It is not yet a PostgreSQL transaction. The persistence slice must connect this boundary
to Drizzle, the Unit of Work, entity-state writes, journal, and outbox.

## Developer-facing proof

An action is one role-scoped class with one typed handler:

```ts
export class IncrementCounter extends Action<IncrementCounterInput, number> {
  static id = 'increment-counter'

  private readonly counter = this.inject(ExecutionCounter)

  handle(input: IncrementCounterInput): number {
    this.counter.value += input.amount
    return this.counter.value
  }
}
```

A query has the same shape but receives read-only execution semantics:

```ts
export class ReadCounter extends Query<void, number> {
  static id = 'read-counter'

  private readonly counter = this.inject(ExecutionCounter)

  handle(): number {
    return this.counter.value
  }
}
```

The Feature remains a readable table of contents:

```ts
export class OperationsFeature extends Feature {
  id = 'operations'
  actions = [IncrementCounter, FailCounter]
  queries = [ReadCounter]
}
```

Application and transport code dispatch through typed buses:

```ts
await actions.execute(IncrementCounter, { amount: 2 })
await queries.execute(ReadCounter, undefined)
```

## Execution scope

Entry adapters call `runtime.admit(seed, work)` before application code. Admission:

- Validates the actor and initiator contract.
- Creates a fresh execution and default correlation ID.
- Freezes context, actor, authentication, transport, trace, tenant, and delegation values.
- Combines caller cancellation with the runtime-owned cancellation signal.
- Carries context and scope privately through Node.js `AsyncLocalStorage`.
- Rejects nested admission rather than creating accidental child containers.
- Rejects new work as soon as runtime draining begins.

Application services opt into one-instance-per-execution behavior explicitly and locally:

```ts
export class ExecutionCounter implements ExecutionScoped, Disposes {
  constructor(private readonly execution: CurrentExecution) {}

  increment(amount: number): void {
    this.execution.assertWritable()
    // mutate execution-owned state
  }

  dispose(context: LifecycleContext): void {
    // release execution-owned state
  }
}
```

The compiler recognizes the explicit `implements ExecutionScoped` clause and records `execution`
scope in the manifest. Ordinary reachable concrete services remain transient without ceremony.
Singletons remain explicit Feature provider roots. A singleton dependency path that reaches an
execution-scoped service fails compilation.

## Dispatch semantics

- Every declared action and query has an explicit stable ID.
- Handler classes are transient and resolve inside the current admitted scope.
- Actions require exactly one manifest-visible `TransactionManager` provider.
- Each top-level action enters that transaction boundary and commits or rolls back through it.
- Queries never enter the transaction provider.
- Dispatch outside an admitted execution fails.
- Action dispatch while another operation is active fails as prohibited nested dispatch.
- Query dispatch may participate in the active execution without creating another scope.
- `ActionBus` and `QueryBus` are compiler-known injection identities, not service locators.
- `CurrentExecution` is an injectable, compiler-known context accessor whose `assertWritable()`
  guard rejects framework-managed mutation unless an action is active.

Queries do not receive the action transaction boundary, cannot dispatch an action while their
handler is active, and fail `CurrentExecution.assertWritable()`. The persistence slice will make the
Unit of Work and model mutation APIs call that guard automatically; arbitrary JavaScript object
mutation is naturally outside what any framework can prevent.

## Compiler proof

The compiler now:

- Discovers all action, query, and provider roots before resolving any dependency, so array order
  has no semantic effect.
- Verifies Doxa role identity by TypeScript symbol provenance rather than class-name matching.
- Requires concrete role classes and one `handle(input)` method.
- Rejects operation classes injected directly as dependencies and directs callers to the buses.
- Emits action/query transaction semantics and dependency graphs in the canonical manifest.
- Keeps the registry constructor-only.
- Rejects missing or competing transaction providers before artifact emission.
- Rejects singleton-to-execution scope capture and dependency cycles.

## Runtime proof

The runtime now:

- Verifies operation constructor identity against the generated registry.
- Isolates concurrent execution scopes and contexts through `AsyncLocalStorage`.
- Reuses execution-scoped services across inline actions and queries.
- Creates fresh transient handlers for each dispatch.
- Preserves the primary operation failure while disposing the scope.
- Runs scoped disposal in reverse construction order on success and failure.
- Propagates execution deadlines through `AbortSignal`.
- Stops admission during drain and waits for accepted executions before stopping singletons.

## Executable evidence

The complete suite now contains fifteen passing conformance tests. The second slice specifically
proves:

1. Stable action, query, transaction-provider, and execution-scope manifest entries.
2. Shared execution-scoped state across inline actions and queries.
3. Isolation and unique execution IDs across concurrent executions.
4. Transaction commit for successful actions and rollback for failed actions.
5. No transaction entry for queries.
6. Read-only mutation-guard failure during queries.
7. Scoped disposal after both success and failure.
8. Rejection of dispatch outside an execution and nested action dispatch.
9. Actor validation, frozen context, initiator defaulting, and correlation creation.
10. Rejection of nested admitted scopes.
11. Admission closure and accepted-work completion during drain.
12. Deadline propagation through cancellation.

Run the proof with `pnpm test`.

## Next slice

Completed: [PostgreSQL durability vertical slice](postgresql-durability-vertical-slice.md).

Also completed over that boundary:
[Eloquent-style model vertical slice](eloquent-model-vertical-slice.md).

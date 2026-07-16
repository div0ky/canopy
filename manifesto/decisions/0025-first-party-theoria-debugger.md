# 0025: Build Theoria as Doxa's First-Party Development Debugger

- **Status:** Accepted
- **Accepted:** 2026-07-11
- **Scope:** Optional first-party product
- **Decision owners:** Doxa maintainers
- **Amended by:** [0031: Production Theoria](0031-production-theoria.md)

## Decision

Doxa will provide **Theoria**, a first-party, optional development debugger inspired by Laravel
Telescope. Theoria records typed framework observations and presents requests, operations,
persistence, models, events, signals, queues, authorization, communications, logs, and failures as
one causal timeline.

> Theoria reveals everything happening beneath the surface.

Theoria is distinct from logging, metrics, tracing, audit history, and Gnosis:

- Logging communicates operational records.
- Telemetry exports aggregate and distributed-observability signals.
- Audit and journal records are durable business or security facts.
- Gnosis explains the application graph and how to engineer within it.
- Theoria retains rich, development-oriented execution evidence for interactive exploration.

## Programming and installation model

Theoria is installed explicitly rather than silently bundled into every production runtime:

```sh
doxa add theoria
doxa theoria
doxa theoria:prune
```

The generated application composition selects the Theoria recorder. Doxa runtime emits the same
typed observation contract whether Theoria is installed or not; the default recorder is a no-op.
Application roles never call Theoria directly.

## Causal timeline

Every observation carries the applicable execution, correlation, causation, trace, actor, tenant,
transport, and stable manifest-role identity. The primary UI is an execution timeline rather than an
unrelated list of database rows:

```text
POST /orders
  -> actor user:123 authenticated
  -> orders.create allowed by policy:orders/order
  -> action:orders/create-order
  -> transaction opened
  -> model:orders/order saved
  -> event:orders/order-created dispatched
  -> job:mail/send-receipt queued
  -> transaction committed
  -> HTTP 201
```

Cross-process queue work starts a new execution while retaining its source execution, correlation,
and causation relationships. Theoria must make that transition navigable.

## Storage and retention

The first-party recorder stores observations in PostgreSQL so HTTP, worker, scheduler, and console
processes contribute to the same view and evidence survives hot reload. Theoria owns only its
namespaced tables and migrations.

Retention is bounded by default. Age and maximum-entry limits are explicit configuration, pruning is
available through Praxis, and automatic pruning may run probabilistically without delaying the
observed execution. Theoria is not an indefinite audit archive.

## Safety boundaries

- Disabled unless explicitly installed and enabled.
- Development and test environments only by default; production requires an explicit override.
- Secret-like keys, credentials, cookies, authorization headers, tokens, and `SecretString` values
  are recursively redacted before crossing the observation boundary.
- Request and response bodies are disabled by default, opt-in, size-limited, and redacted.
- Database bindings are never recorded as raw values by default.
- Observation failures never change application behavior.
- Recording cannot monkey-patch `console`, database drivers, or application classes.
- The UI binds to loopback by default and has no production-safe remote-access claim.
- Theoria endpoints never pass through application authentication or business middleware as a hidden
  public surface; the dedicated development host owns access.

## Typed observation contract

Doxa core owns a stable `Observation` contract and an `ObservationRecorder` port. Runtime and
first-party adapters emit semantic observations at owned boundaries. Theoria implements the port;
telemetry providers remain independently selectable.

The recorder receives already-sanitized immutable values. Dynamic arbitrary objects and raw errors
do not cross the contract. Gnosis consumes the observation vocabulary and stable role IDs so it can
explain timeline entries and link them to source declarations.

## Consequences

- Debugging follows one execution across framework subsystems and asynchronous boundaries.
- Runtime and adapters must expose semantic observation points instead of relying on incidental log
  parsing.
- The observation contract becomes a versioned application-facing guarantee.
- PostgreSQL writes add development overhead, bounded by optional installation and retention.
- Theoria must remain useful without becoming a production APM or audit substitute.

## Required implementation proof

1. HTTP, action/query, transaction, event/listener, signal, job, authorization, and failure entries
   appear in causal order under one execution.
2. Queued work links source and worker executions through correlation and causation identifiers.
3. PostgreSQL retention survives hot reload and prunes deterministically.
4. Recorder failure cannot fail or alter an application execution.
5. Secrets and credentials do not appear in stored attributes, errors, HTTP capture, or UI JSON.
6. Praxis installs, runs, inspects, and prunes Theoria without manual package wiring.
7. The loopback UI supports execution listing, filtering, timeline inspection, and source-role
   context.
8. Gnosis describes the installed debugger and its observation vocabulary.
9. Theoria remains absent and zero-work when not installed.

## References

- [Actor and execution context](../specifications/actor-execution-context-authorization.md)
- [First-class logging](../specifications/logging.md)
- [Gnosis](0013-first-party-ai-engineering-mcp.md)
- [Praxis](0004-first-party-cli-generators.md)

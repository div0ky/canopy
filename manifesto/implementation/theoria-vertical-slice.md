# Distributed Observability and Theoria Vertical Slice

- **Status:** Implemented proof
- **Manifest format:** 4
- **Completed:** 2026-07-16

Doxa now owns one coherent observability context across executions, nested framework work, logs,
telemetry, and semantic observations. Each admitted request or worker delivery creates an execution
span beneath valid inbound W3C context. Actions, queries, commands, routes, transactions, model
operations, authorization, listeners, reactions, jobs, queue and communication adapters, broadcasts,
and AI operations create child spans. Delayed and retried work carries explicit links when a single
parent would misstate causality. Queue attempt trace identities are persisted until terminal
completion, so retry links survive worker replacement and SDK-assigned span IDs. Business
correlation and causation remain separate from span parentage.

`@doxajs/opentelemetry` bridges the vendor-independent `Telemetry` port to the registered
OpenTelemetry API. The adapter-reported trace and span IDs become the active Doxa context, so
exported spans, Theoria observations, structured logs, queue envelopes, and HTTP response headers
agree. The adapter does not choose an exporter, endpoint, or credentials for the application.

Theoria persists immutable, redacted observations with parent span IDs, span links, opaque text
correlation IDs, and application, service, environment, release, and instance resource identity. Its
timeline preserves chronological semantic and causal facts. Its waterfall groups the matching
started and terminal records into hierarchical spans, while links navigate producer, worker, and
retry executions.

The default remains a loopback development explorer. The supported `production-diagnostics` profile
is public application configuration and fails closed without explicit enablement. Its PostgreSQL
recorder uses deterministic execution sampling, kind/phase/name/duration filters, batched writes, a
bounded pending buffer, explicit overflow behavior, a dedicated pool, health counters,
cursor-bounded queries, a hot table, monthly warm partitions, and retention pruning. Recorder
saturation and write failure drop diagnostics without changing application behavior. Non-loopback
access requires an authenticated and authorized operator and mandatory access audit.

`AiObservability` supplies privacy-safe model, operation, token-count, tool, critic, retry, latency,
and safe outcome evidence. Its public metadata contract intentionally has no prompt, completion,
message body, phone number, arbitrary tool payload, or customer-PII field. Recursive sanitization is
defense in depth before either telemetry or recorder boundaries.

Praxis owns installation and operation:

```sh
doxa add opentelemetry
doxa add theoria
doxa migrate
doxa theoria
doxa theoria:prune
```

Executable evidence lives in `tests/foundation.test.ts`, `tests/praxis.test.ts`,
`tests/persistence.test.ts`, and `tests/persistence/compilation-and-theoria.ts`. It covers shared
OpenTelemetry IDs, nested parentage, queue retry links, AI privacy and outcomes, schema migration,
non-UUID correlations, complete-span filtering, resource identity, bounded capture health, warm
partitions, cursor queries, protected audited access, causal navigation, and waterfall projection.
The reference application demonstrates nested tracing and first-class AI observations through the
same runtime ports.

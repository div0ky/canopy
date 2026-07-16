# 0030: Provide Standards-Correct Distributed Tracing

- **Status:** Accepted
- **Accepted:** 2026-07-16
- **Scope:** Core execution context, runtime instrumentation, and optional telemetry adapter
- **Decision owners:** Doxa maintainers

## Decision

Doxa will create a standards-compatible span tree for framework-owned timed work and export it
through an independently selectable first-party OpenTelemetry adapter. Semantic observations and
telemetry spans share trace identity and instrumented boundaries, but remain separate contracts.

Every admitted execution owns a root span. Meaningful nested framework boundaries receive a fresh
span ID and retain their parent span ID. Fan-out, delayed work, retries, and work with more than one
cause use explicit span links where a single parent would misrepresent causality.

## Boundary

- `TraceContext` carries `traceId`, the active `spanId`, optional `parentSpanId`, trace flags, and
  bounded links.
- Runtime-owned instrumented scopes emit a semantic observation pair and a completed telemetry span
  from the same timing and trace context.
- Actions, queries, routes, commands, listener and observer reactions, jobs, transactions, model
  persistence/query operations, queue boundaries, communications, caches, broadcasts, outbound HTTP,
  and AI operations are span-worthy when Doxa owns the invocation.
- Instantaneous facts remain observations on the active span. Attribute access, object construction,
  and arbitrary application methods do not become spans.
- Business correlation and causation IDs are not substitutes for trace parentage.
- Application roles never import OpenTelemetry APIs. The adapter translates Doxa telemetry records
  at the composition boundary.

## Alternatives considered

- **Treat every observation as a span:** rejected because semantic facts are not all timed
  operations and would create misleading, high-volume traces.
- **Keep one span per execution:** rejected because it cannot explain nested latency or emit a
  useful distributed waterfall.
- **Use correlation IDs to reconstruct traces:** rejected because correlation is many-to-many
  business grouping, not standards-correct span parentage.
- **Expose OpenTelemetry directly to application roles:** rejected because vendor APIs would define
  Doxa's application model.

## Consequences

- Doxa traces can participate in cross-service OpenTelemetry systems without losing framework
  semantics.
- Instrumentation overhead grows with meaningful timed boundaries and therefore requires sampling at
  the sink or recorder boundary.
- Theoria can render a waterfall while retaining its richer causal observation timeline.
- Trace propagation changes the stable execution, queue-envelope, logging, observation, and
  telemetry contracts and requires compatibility tests.

## Required implementation proof

1. HTTP parent context produces a child execution span and a valid response `traceparent`.
2. Nested framework work produces distinct child spans with correct parents.
3. Queue producer/consumer, delayed, retry, and fan-out paths preserve trace identity and links.
4. Started/completed/failed observations for one timed scope share one span ID.
5. The OpenTelemetry adapter exports the same names, timing, status, attributes, parents, and links.
6. Instrumentation or exporter failure cannot alter application behavior.

## References

- [Actor and execution context](../specifications/actor-execution-context-authorization.md)
- [Telemetry and tracing](../specifications/telemetry-and-tracing.md)
- [Theoria](0025-first-party-theoria-debugger.md)

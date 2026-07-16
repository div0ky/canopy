# Telemetry and Distributed Tracing

Doxa owns a vendor-independent telemetry contract. Application roles never depend on exporter APIs.
The normative direction is defined by
[decision 0030](../decisions/0030-standards-correct-distributed-tracing.md).

## Trace context

An active trace context contains a W3C-compatible trace ID, active span ID, optional parent span ID,
remote-parent provenance, trace flags, and bounded links. A new execution always receives a new span
ID. An admitted inbound span is the execution span's parent; it is never reused as the execution
span itself.

Queue and durable context envelopes preserve the producer trace. Direct producer/consumer work uses
parentage. Fan-out, scheduled or delayed work, retries, and multi-source work use explicit links
when single parentage would misstate causality. Queue adapters persist the actual trace and span
identity for each attempt until terminal completion so retry links remain correct across worker
processes and telemetry adapters that assign span IDs.

## Instrumented scopes

A runtime-owned instrumented scope creates one child trace context, makes it active for nested work,
and emits:

- one started and one completed or failed semantic observation sharing that span;
- one completed telemetry span with the same trace, span, parent, links, timing, name, status, and
  safe attributes.

Span-worthy boundaries are framework-owned timed invocations: routes, commands, actions, queries,
listeners, signal handlers, model observers, jobs, transactions, persistence queries and writes,
queue operations, caches, communications, broadcasts, outbound HTTP, and AI operations.

Instantaneous semantic facts are observations associated with the active span. Doxa does not trace
attribute reads, object construction, arbitrary domain methods, or framework-private helper calls.

## OpenTelemetry adapter

The first-party adapter translates completed Doxa span records into OpenTelemetry spans. It does not
become the source of execution context, patch global libraries, or expose OpenTelemetry types
through `@doxajs/core`. Export failure is isolated from application behavior.

## Safety and cardinality

Telemetry never includes secrets, prompt or message bodies, credentials, raw database bindings, or
unbounded arbitrary objects. Actor and tenant identifiers are suppressible or pseudonymizable by
sink policy and never become metric labels. Span links and attributes are bounded before reaching a
sink.

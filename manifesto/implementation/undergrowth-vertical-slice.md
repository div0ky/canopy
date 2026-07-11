# Undergrowth Development Debugger Vertical Slice

- **Status:** Implemented proof
- **Manifest format:** 11
- **Completed:** 2026-07-11

Undergrowth is Canopy's optional first-party development debugger. The runtime emits immutable,
typed observations for executions, HTTP, actions, queries, transactions, models, events, listeners,
signals, jobs, schedules, authorization, communications, logs, and exceptions. Every entry carries
the applicable execution, source-execution, correlation, causation, trace, actor, tenant, transport,
and stable role identity.

`@canopy/undergrowth` records those observations into namespaced PostgreSQL tables without blocking
application work. Writes are serialized in the background to preserve causal order; recorder
failures are isolated from the application. Recursive redaction occurs before the adapter boundary,
the dedicated host is loopback-only, production requires an explicit override, and retention
defaults to seven days and 50,000 entries with best-effort and manual pruning.

The read-only explorer provides a newest-first execution rail, kind/status/text/actor search,
cross-execution correlation timelines, stable role provenance, redacted attributes, and exception
inspection. It has been rendered and interaction-tested at desktop and 390-pixel mobile widths.

Arbor owns the complete workflow:

```sh
arbor add undergrowth
arbor migrate
arbor undergrowth
arbor undergrowth:prune
```

Installation writes the dependency, provider, Feature registration, and scripts. Cultivate reports
whether the observation capability is installed, the vocabulary, operator commands, and safety
posture. The first-party test harness automatically substitutes an exposed in-memory recorder when
the compiled manifest selects Undergrowth, while explicit overrides still win.

Executable evidence lives in `tests/foundation.test.ts`, `tests/arbor.test.ts`,
`tests/testing.test.ts`, and `tests/persistence.test.ts`. It covers secret redaction, production
gating, generator wiring, capability compilation, real PostgreSQL recording, ordered timelines,
source-to-worker causation, deterministic retention, recorder failure isolation, loopback/read-only
hosting, and automatic test substitution.

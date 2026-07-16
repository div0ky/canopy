# 0031: Support Theoria as a Production Diagnostics Product

- **Status:** Accepted
- **Accepted:** 2026-07-16
- **Scope:** Optional first-party observation recorder and explorer
- **Decision owners:** Doxa maintainers

## Decision

Theoria will support an explicit, fail-closed `production-diagnostics` profile backed by hardened
PostgreSQL storage and protected operator access. It remains complementary to telemetry, metrics,
logging, alerting, and durable audit or business records; it is not limited to development use.

Production enablement is a public application configuration. A constructor-only escape hatch is not
a supported production contract.

## Boundary

- `development` favors complete local evidence and loopback convenience.
- `production-diagnostics` requires explicit enablement, bounded capture, retention, recorder
  health, and protected access configuration.
- The recorder batches writes through a bounded buffer, applies an explicit overflow policy, exposes
  dropped/write-failure health, and never backpressures application work.
- Capture may be sampled and filtered by kind, status, name, and duration.
- PostgreSQL storage supports time partitioning, hot and warm retention tiers, cursor queries, and a
  dedicated connection pool or database.
- The explorer remains read-only. Non-loopback access requires authenticated operator identity,
  authorization, explicit proxy trust, and access logging.
- Theoria is incident and execution evidence, not an indefinite audit archive or the sole production
  observability system.

## Alternatives considered

- **Development-only forever:** rejected because Doxa's semantic observations are valuable during
  production incidents and can be operated safely with explicit controls.
- **An unqualified `allowProduction` boolean:** rejected because it bypasses a guard without
  defining capacity, access, retention, or failure behavior.
- **Reuse application authentication middleware:** rejected because the dedicated operator surface
  must not become a hidden business endpoint or inherit application middleware accidentally.
- **Require an external hosted service:** rejected because `ObservationRecorder` deliberately
  permits a hardened internal PostgreSQL implementation.

## Consequences

- Teams may rely on Theoria for bounded production diagnostics without sending evidence to an
  external service.
- Production support materially expands the storage, security, operational, and load-test
  obligations of `@doxajs/theoria`.
- Safe defaults remain development-oriented; production activation stays explicit.
- The causal timeline and hierarchical waterfall become complementary projections of the same data.

## Required implementation proof

1. Production startup fails closed without explicit enablement and access configuration.
2. Saturation drops according to policy, reports health, and never delays application execution.
3. Batched writes, partitions, retention tiers, and cursor queries remain bounded at target volume.
4. Non-loopback requests require authenticated and authorized operator access and are audited.
5. Redaction and capture exclusions hold before records enter the buffer or database.
6. Recorder, storage, and explorer failure cannot alter application behavior.

## References

- [First-party Theoria debugger](0025-first-party-theoria-debugger.md)
- [Theoria specification](../specifications/theoria.md)
- [Doxa security model](../security.md)

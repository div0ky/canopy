# Praxis Runtime and Observability Vertical Slice

- **Status:** Implemented proof
- **Manifest format:** 11
- **Completed:** 2026-07-10

Praxis now owns Doxa's complete daily command surface: application creation, all canonical role
generators, TypeScript/manifest builds, forward migrations with checksums and advisory locking,
independent `serve`, `work`, and `schedule` roles, combined `dev`, application console commands,
focused manifest inspection, database browsing through `db:studio`, queue recovery, and
communications recovery.

Application commands are explicit Feature roles. They compile into the manifest, use scoped
`this.inject()` dependencies and default-deny authorization, receive one normal admitted execution
scope, and run as a system actor through `doxa namespace:command`. Praxis installs process signal
handlers as the host; `Doxa.boot()` remains free of process-global side effects.

Gnosis receives `.doxa/gnosis.json`, a derived non-runtime view of the canonical manifest. It
records every role and source plus Doxa's DX, safety, folder, authorization, migration, and
generator conventions. The manifest and constructor registry remain the two canonical runtime
artifacts.

Doxa also owns a vendor-independent `Telemetry` port for metrics and nested spans. First-class
application and framework logging is specified separately in
[First-class logging](../specifications/logging.md). Runtime admission emits structured telemetry
events, metrics, and spans with actor, correlation, causation, tenant, transport, and trace fields.
HTTP validates and propagates W3C trace context; queues and durable records preserve it. The runtime
generates trace/span IDs when no parent exists and uses parentage or explicit links for asynchronous
work. Telemetry adapters are isolated from application behavior. The in-memory reference adapter and
`@doxajs/opentelemetry` prove deterministic capture and SDK-correct exported parentage without
secret values.

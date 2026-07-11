# Canopy

Canopy is an opinionated, class-first TypeScript application framework inspired by Laravel's
coherence and developer experience. It is magical where that magic is safe, deterministic and
inspectable beneath the surface, trivial for Cultivate to understand, and deliberately difficult
to misuse.

Canopy 0.1 is a functioning framework MVP. The implementation proves one connected application
model:

```text
Application + Feature declarations
  → semantic TypeScript compiler
  → deterministic manifest + constructor registry
  → typed configuration
  → dependency container
  → ready runtime
  → admitted execution context and scope
  → transactional actions and read-only queries
  → PostgreSQL/Drizzle Unit of Work
  → execution-scoped Eloquent-style ModelSession
  → hydrated models with find(), save(), delete(), refresh(), and dirty tracking
  → typed local and after-commit class events
  → atomic entity state + journal + outbox
  → compiled Canopy routes over a private Hono engine
  → actor-aware HTTP requests and normalized responses
  → transactional jobs and queued listeners
  → atomic outbox-to-pg-boss handoff
  → retrying, actor-aware workers with graceful drain
  → class-first cron and interval schedules
  → deterministic pg-boss reconciliation and causal system firing
  → first-party email/password identities and opaque sessions
  → authenticated HTTP actors, rotation, CSRF enforcement, and revocation
  → opaque bearer credentials for APIs, CLIs, and automation
  → compiled default-deny entry and resource authorization policies
  → first-party signals and Eloquent-style model observers
  → transactional mail and SMS with SendGrid and Twilio adapters
  → framework cache, telemetry, diagnostics, and testing fakes
  → Arbor generation, migrations, runtime roles, inspection, and recovery
  → Cultivate-readable application knowledge
  → idempotent shutdown
```

The design authority lives in the [Canopy Manifesto](manifesto/index.md). The exact proof already
implemented is documented in the
[implementation proofs](manifesto/implementation/index.md).

## Workspace

- `@canopy/core` — application-facing declarations, models, and lifecycle contracts.
- `@canopy/manifest` — versioned serializable artifact contract.
- `@canopy/compiler` — strict semantic analysis and deterministic artifact generation.
- `@canopy/runtime` — artifact validation, configuration, construction, and lifecycle.
- `@canopy/http-hono` — private Hono fetch engine and lifecycle-coordinated Node host.
- `@canopy/auth-postgres` — first-party identity, Argon2id credential, browser-session, and PostgreSQL auth adapter.
- `@canopy/postgres-drizzle` — private PostgreSQL transaction and durability adapter.
- `@canopy/queue-pg-boss` — private pg-boss queue, outbox handoff, worker, and scheduler adapter.
- `@canopy/sendgrid` and `@canopy/twilio-sms` — provider adapters behind Canopy communications.
- `@canopy/testing` — real-manifest harness and auth, persistence, queue, schedule, cache,
  communications, and telemetry fakes.
- `@canopy/arbor` — the canonical generator, command, runtime, inspection, and recovery suite.
- `examples/reference-app` — executable conformance fixture.
- `examples/persistence-app` — domain-organized auth, HTTP, event, model, queue, worker, schedule, and PostgreSQL
  fixture.
- `examples/field-guide` — external-consumer Next.js, Tailwind, and shadcn/ui browser fixture for
  public HTTP, first-party auth, bearer tokens, protected actions, and queued work.

## Development

Canopy requires Node.js 24 and pnpm.

```bash
pnpm install
pnpm check
pnpm test
pnpm audit:mvp
pnpm dev
```

Generated `dist/` and `.canopy/` artifacts are intentionally ignored.

## Existing PostgreSQL schemas

Models can opt into existing tables with `static table`, plus optional `primaryKey`, `columns`,
`timestamps`, and `versionColumn` overrides. They retain the normal Eloquent-style API and use
PostgreSQL `xmin` for optimistic concurrency when no version column exists.

First-party auth can explicitly map identity and password fields onto existing tables while
Canopy continues to own sessions, bearer tokens, challenges, abuse controls, and audit records.
See the [mapping implementation proof](manifesto/implementation/existing-table-mapping-vertical-slice.md)
for the exact configuration and guarantees.

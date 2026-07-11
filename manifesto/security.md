# Canopy Security Model and Threat Assessment

- **Scope:** Canopy MVP server runtime and first-party adapters
- **Reviewed:** 2026-07-10
- **Rule:** Framework convenience may remove ceremony, never an authorization or durability boundary.

## Protected assets

Canopy protects password verifiers, session and bearer credentials, verification and recovery
challenges, application secrets, identity and authorization records, tenant boundaries, entity
state, journal facts, queued work, communications content, provider credentials, and causal
telemetry. Raw credentials are more sensitive than identifiers and must never enter storage,
logs, manifests, diagnostics, or error responses.

## Trust boundaries

Untrusted HTTP input crosses the Hono adapter into a Canopy-admitted execution. Browser cookies,
bearer headers, signed provider callbacks, queue envelopes, environment configuration, and compiled
artifacts are separate boundaries. PostgreSQL is trusted for durability but its contents are not
assumed secret from operators; this is why opaque credentials are stored as digests. SendGrid and
Twilio are external delivery systems and receive only provider-required message data.

The generated JSON manifest is inert and readable without code execution. The constructor registry
is executable and must match its manifest build hash and supported format versions before boot.

## Threats and controls

| Threat | First-party control | Executable evidence |
| --- | --- | --- |
| Credential database disclosure | Argon2id password records; SHA-256 digest-only opaque session, bearer, verification, and reset tokens | Storage assertions reject raw material and require versioned parameters/digests |
| Account enumeration | Equivalent login failure and recovery responses; dummy Argon2id verification | Known/unknown negative HTTP tests |
| Brute force and recovery abuse | Durable hashed attempt buckets, bounded windows, temporary blocks, `429` and `Retry-After` | PostgreSQL abuse-control tests |
| Session fixation or replay | Cryptographic tokens, rotation, bounded previous-token grace, revocation on password change/reset | Rotation, concurrent grace, old-token, logout, and revocation tests |
| CSRF against cookie authority | Trusted-origin checks for unsafe cookie-authenticated requests | Hostile-origin rejection tests |
| Confused credential authority | Cookie plus bearer is rejected; bearer constraints only narrow authority | Ambiguity and constraint-denial tests |
| Missing or bypassed authorization | Every entry role declares `public` or an ability; policies compile; missing policies deny | Compiler diagnostics and default-deny tests |
| Cross-resource access | Explicit resource authorization with the current actor, tenant, and credential constraints | Owner/non-owner policy tests and durable decisions |
| Ghost jobs or notifications | Queue, journal, entity, and delivery handoffs share the action transaction | Rollback and visibility tests |
| Forged provider delivery updates | Exact-body SendGrid ECDSA verification and timestamp window; canonical Twilio HMAC verification | Valid, malformed, stale, and duplicate webhook fixtures |
| Artifact substitution | Application identity, manifest version, build hash, and constructor registry compatibility fail closed | Compiler/runtime compatibility tests |
| Secret leakage through framework telemetry | Structured allowlisted attributes, `SecretString`, provider-independent errors, safe operator views | Redaction assertions and boundary audit |
| Denial during shutdown | Admission closes before drain; bounded lifecycle deadlines; cancellation and full cleanup aggregation | Lifecycle and active-worker drain tests |

## Security invariants

- Authentication proves identity; authorization independently decides authority.
- Bearer credentials are opaque, one-time visible grants. They are not JWTs and carry no trusted
  client-readable claims.
- Optional dependencies never silently weaken a required security control.
- Constructors perform no I/O. Security-sensitive startup and teardown participate in bounded
  lifecycle phases.
- Queue and schedule executions receive fresh scopes while preserving actor, initiator,
  authentication, correlation, causation, tenant, and trace context.
- Diagnostics expose identity and record identifiers, states, and timestamps, not credentials,
  digests, secrets, message bodies, or cache values.

## Supply-chain and provenance posture

The MVP uses a frozen pnpm lockfile and exact root toolchain versions. Application-facing packages
own their contracts; Hono, Drizzle, pg-boss, Argon2 primitives, SendGrid, and Twilio remain behind
adapter packages. `pnpm audit:boundaries` fails when reference application code imports a vendor
runtime directly. `pnpm audit:docs` verifies local knowledge-base links. Release artifacts must be
built from the reviewed lockfile and publish only declared package output and migrations.

## Release gate

This assessment and the automated negative suite are the MVP internal review. Before a public
security-stability claim or 1.0 release, maintainers must obtain an independent review of auth,
authorization, webhook verification, queue recovery, package provenance, and denial-of-service
limits. Findings are release blockers according to severity; the existence of that external gate
does not transfer first-party ownership of these controls to another package.

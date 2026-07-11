# 0005: Use Node.js 24 as the Initial Runtime

- **Status:** Accepted
- **Accepted:** 2026-07-10
- **Decision owners:** Doxa maintainers

## Decision

Doxa will target Node.js 24 as its initial application, worker, console, and tooling runtime. The
initial minimum version is Node.js 24.7 because that release introduces the built-in Argon2
primitive required by first-party Doxa authentication.

Doxa packages will express the supported range as Node.js 24.7 or newer within the 24.x release
line. Doxa releases may raise the minimum 24.x patch when required for correctness or security, but
they will document that change explicitly.

## Context

Selecting one runtime lets Doxa provide a coherent compatibility contract for HTTP serving,
cryptography, asynchronous execution context, process signals, diagnostics, workers, and the CLI.
Doxa should not weaken its initial programming model to claim portability across runtimes that have
different process, networking, cryptographic, or lifecycle behavior.

Node.js 24 supplies the stable server runtime Doxa needs while preserving Web Standards `Request`
and `Response` at the HTTP boundary. Node.js 24.7 adds built-in Argon2 support, allowing the
first-party authentication subsystem to use a platform cryptographic primitive rather than making an
authentication framework or native password-hashing package foundational.

## Boundary

- Node.js APIs may be used inside the kernel, runtime adapters, workers, CLI, and infrastructure
  packages where Doxa owns their lifecycle.
- Feature APIs should prefer Doxa contracts and Web Standards where doing so preserves the intended
  semantics.
- Doxa v1 does not promise that applications run unchanged on Bun, Deno, edge runtimes, or
  browser-like worker environments.
- HTTP application code remains independent of Node's request and response types.
- Runtime-specific failures are normalized into Doxa diagnostics and lifecycle errors.

## Consequences

- Doxa can design and test one deterministic process and shutdown model.
- First-party authentication can use Node's built-in Argon2id implementation.
- The Hono adapter can use its Node.js server integration without making Node HTTP types public.
- Applications that require another runtime will need a future runtime adapter and conformance
  suite.
- The supported Node patch range becomes part of every Doxa release's compatibility contract.

## Required implementation proof

The runtime conformance suite must cover:

1. Boot, readiness, partial-startup failure, drain, and shutdown.
2. Request and job execution-context isolation.
3. Signal handling and deterministic resource disposal.
4. Cryptographic randomness and Argon2id password hashing.
5. Hono request handling through Web Standards objects.
6. Worker and console execution under the same application manifest.
7. CLI behavior in interactive and non-interactive environments.

## Revisit when

- Node.js 24 approaches the end of Doxa's supported maintenance window.
- A newer Node.js line materially improves security or removes required compatibility work.
- Another runtime can satisfy the full kernel, HTTP, cryptography, worker, CLI, and lifecycle
  conformance suites without weakening the application model.

## References

- [Doxa HTTP engine decision](0001-hono-http-engine.md)
- [Doxa first-party authentication decision](0003-first-party-authentication.md)
- [Node.js cryptography documentation](https://nodejs.org/api/crypto.html)

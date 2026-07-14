# Doxa.js

[![CI](https://github.com/div0ky/doxajs/actions/workflows/ci.yml/badge.svg)](https://github.com/div0ky/doxajs/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-24-43853d.svg)](.node-version)

Doxa.js is an opinionated, class-first TypeScript application framework inspired by Laravel's
coherence and developer experience. It is magical where that magic is safe, deterministic and
inspectable beneath the surface, trivial for Gnosis to understand, and deliberately difficult to
misuse.

> **Pre-1.0 status:** Doxa.js is an open-source alpha. Its connected application model is
> implemented and extensively tested, but APIs may still change and the independent security review
> required for a production-stability claim is not complete. Tagless installs currently resolve to
> the alpha release.

## The Doxa experience

```ts
import { Feature, Route, type HttpRequest } from '@doxajs/core'

export class HomeRoute extends Route {
  static override readonly id = 'home'
  static override readonly access = 'public'
  readonly method = 'GET'
  readonly path = '/'

  handle(_request: HttpRequest) {
    return { application: 'my-application' }
  }
}

export class AppFeature extends Feature {
  id = 'app'
  routes = [HomeRoute]
}
```

The application route returns only its payload. Doxa separately owns the mandatory `GET /health`
endpoint and its operational contract. Doxa compiles the declaration, constructs its dependencies,
admits an execution scope, resolves the actor, enforces authorization, adds correlation and trace
context, records structured evidence, and returns
`{ ok: true, data: { application: 'my-application' } }`.

## Create an application

After the alpha packages are published:

```sh
pnpm dlx @doxajs/praxis new MyApplication
cd my-application
pnpm install
cp .env.example .env
docker compose up -d
pnpm migrate
pnpm dev
```

Praxis generates a small application surface: root `app.config.ts`, an editable `AppFeature`, tests,
Gnosis knowledge, and production container files. Mandatory HTTP, PostgreSQL/Drizzle, pg-boss,
authentication, and operational routes remain framework-owned and out of user source.

To work on Doxa itself before package publication, follow the
[contributor setup](CONTRIBUTING.md#development-setup).

## What is included

- Declaration-only Applications and Features with a fail-closed semantic compiler.
- Class-first roles with automatic scoped `this.inject()` and class-bound logging.
- Hono HTTP admission with automatic success and failure envelopes.
- PostgreSQL/Drizzle transactions, Eloquent-style models, journal, outbox, and cache.
- Laravel-like events, listeners, signals, observers, jobs, and schedules.
- First-party email/password, opaque browser-session, and opaque bearer authentication.
- Default-deny entry and resource authorization.
- SendGrid mail and Twilio SMS adapters behind Doxa-owned contracts.
- W3C trace context, structured logs, metrics, diagnostics, and testing fakes.
- Theoria, the causal development debugger.
- Praxis, the generator, migration, runtime, inspection, and recovery command suite.
- Gnosis, the automatically registered local read-only MCP server over the compiled application
  graph and versioned guidance.

## Repository map

| Area                                               | Purpose                                                           |
| -------------------------------------------------- | ----------------------------------------------------------------- |
| [`packages/core`](packages/core)                   | Stable application-facing programming model                       |
| [`packages/manifest`](packages/manifest)           | Versioned inert manifest contract                                 |
| [`packages/compiler`](packages/compiler)           | Semantic TypeScript compiler                                      |
| [`packages/introspection`](packages/introspection) | Typed protocol-independent application inspection                 |
| [`packages/gnosis`](packages/gnosis)               | Local read-only MCP engineering server                            |
| [`packages/runtime`](packages/runtime)             | Container, execution, dispatch, and lifecycle                     |
| [`packages/praxis`](packages/praxis)               | Generator and command suite                                       |
| [`packages/testing`](packages/testing)             | First-party harnesses and fakes                                   |
| `packages/*` adapters                              | Hono, PostgreSQL, queues, auth, communications, and Theoria       |
| [`examples`](examples)                             | Runtime, persistence, and external Next.js reference applications |
| [`docs`](docs)                                     | User and maintainer documentation                                 |
| [`manifesto`](manifesto/index.md)                  | Principles, accepted decisions, specifications, and proof ledger  |

## Documentation

- [Getting started](docs/getting-started/index.md)
- [Application model](docs/concepts/application-model.md)
- [Events, jobs, and schedules](docs/guides/events-jobs-schedules.md)
- [Operations and deployment](docs/operations/deployment.md)
- [Package reference](docs/reference/packages.md)
- [Upgrading](docs/upgrading/index.md)
- [Architecture](manifesto/architecture.md)
- [Security model](manifesto/security.md)

## Development

Doxa supports Node.js 24 and pnpm 11.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm build
cp .env.example .env
docker compose up -d postgres
pnpm doxa migrate
pnpm verify
pnpm dev
```

`pnpm verify` runs formatting, linting, strict TypeScript, the production Field Guide build,
coverage, PostgreSQL integration tests, architecture and documentation audits, packed npm package
validation, Changeset accountability, packed-consumer installation, production dependency
inspection, and the security audit.

## Community

- Read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing a change.
- Use [GitHub Discussions](https://github.com/div0ky/doxajs/discussions) for questions and design.
- Use [GitHub Issues](https://github.com/div0ky/doxajs/issues) for reproducible defects.
- Report vulnerabilities privately according to [SECURITY.md](SECURITY.md).
- See [MAINTAINERS.md](MAINTAINERS.md) and [GOVERNANCE.md](GOVERNANCE.md) for project stewardship.
- Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

Doxa is licensed under the [Apache License 2.0](LICENSE).

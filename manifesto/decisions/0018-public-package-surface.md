# 0018: Provide One Primary Application-Facing Package

- **Status:** Accepted
- **Accepted:** 2026-07-10
- **Scope:** MVP
- **Decision owners:** Doxa maintainers

## Decision

Ordinary application and domain code uses one primary Doxa programming-model package:

```ts
import { Action, Event, Feature, Model, Query, ShouldQueue, token } from '@doxajs/core'
```

Compiler, container, manifest, registry, lifecycle, and runtime implementation packages are not
application dependencies. Internal package refactors must not require feature-code rewrites.

## Separate public surfaces

Testing and infrastructure adapters have intentionally separate packages:

```ts
import { DoxaTest } from '@doxajs/testing'
import { HonoFeature } from '@doxajs/http-hono'
import { DrizzleFeature } from '@doxajs/postgres-drizzle'
```

`@doxajs/testing` may expose test applications, fakes, assertions, clocks, and scoped overrides. It
must not make test-only behavior available through the production programming model.

Adapter packages expose composition-boundary Features, configuration schemas, and adapter-owned
diagnostics. Feature and domain implementation code must not import their engine APIs or private
adapter types.

## Core boundary

`@doxajs/core` owns the stable vocabulary used by application code, including:

- Application and Feature declarations.
- Role base classes and capability interfaces.
- Models, actions, queries, events, listeners, observers, jobs, schedules, policies, and resources.
- Abstract application ports and typed tokens.
- Public validation, error, execution-context, and lifecycle-facing contracts.
- Public configuration types required by application declarations.

It must not expose:

- TypeScript compiler APIs or build orchestration.
- Container implementation or imperative resolution.
- Manifest emission or registry internals.
- Hono, Drizzle, pg-boss, telemetry transport, or vendor SDK types.
- Process-host implementation.
- Test-only mutation or assertion APIs.

## Internal package graph

The MVP physically separates architectural responsibilities:

```text
@doxajs/core
@doxajs/manifest
@doxajs/compiler
@doxajs/runtime
@doxajs/testing
@doxajs/cli
```

- `@doxajs/core` contains the application programming model and public contracts only.
- `@doxajs/manifest` contains the serializable manifest schema, validation, and format compatibility
  contracts only.
- `@doxajs/compiler` analyzes TypeScript and emits canonical manifest and constructor registry
  artifacts.
- `@doxajs/runtime` consumes generated artifacts and owns the container, dispatch, execution scopes,
  and lifecycle.
- `@doxajs/testing` builds on public core plus deliberate runtime testing contracts.
- `@doxajs/cli` orchestrates compiler, generators, diagnostics, operational commands, and official
  hosts.

The runtime cannot import TypeScript compiler APIs, compile source, or reconstruct the graph at
boot. The compiler is unnecessary in the production runtime image. `@doxajs/manifest` remains a
data-contract package and cannot depend on runtime, compiler, CLI, testing, or infrastructure
adapters.

Package cycles and forbidden dependency directions fail architectural checks in CI.

## Composition boundary

The Application declaration and host entry point may import first-party adapter Features to select
infrastructure. Those imports are composition, not permission for domain Features to depend on
adapter implementation types.

The compiler records adapter provenance and verifies that private engine types do not cross into
application-facing manifest contracts.

## Closed exports

Every Doxa package defines an explicit package `exports` map. Cross-package consumers may import
only declared package roots and intentional public subpaths. Deep imports into source, build output,
or unexported implementation modules are forbidden.

```ts
import { Action } from '@doxajs/core'
import { Manifest } from '@doxajs/manifest'
```

```ts
// Invalid
import { Container } from '@doxajs/runtime/dist/container.js'
import { compileClass } from '@doxajs/compiler/src/internals.js'
```

Relative imports across workspace-package boundaries are also forbidden. Adapter and testing
integration may use deliberate exported contract subpaths, but those paths become supported
compatibility surfaces and cannot be informal backdoors into internals.

When multiple packages genuinely require an internal concept, maintainers must promote it into an
intentional contract or move ownership to the correct lower-level package. CI validates exports,
dependency direction, source imports, and published package contents.

## Consequences

- Developers learn one stable programming-model import surface.
- Testing remains powerful without polluting production APIs.
- Adapters can evolve or be replaced without changing domain code.
- Internal packages may be split for architectural enforcement without becoming user-facing
  concepts.
- The core facade requires deliberate compatibility and export discipline.

## Required implementation proof

The MVP must prove:

1. A reference Feature imports all ordinary framework vocabulary from `@doxajs/core` only.
2. Test code uses `@doxajs/testing` without test APIs leaking through core.
3. Hono, Drizzle, and pg-boss types appear only in their adapter packages and internal tests.
4. Swapping an adapter implementation does not rewrite feature or domain code.
5. Manifest and source diagnostics identify forbidden private-package imports.
6. Runtime boots generated artifacts without compiler or TypeScript dependencies installed.
7. Manifest schema validation runs without importing compiler or runtime implementation.
8. Architectural checks reject package cycles and forbidden dependency directions.
9. Deep imports and cross-package relative imports fail architectural checks.
10. Published artifacts contain only files reachable through deliberate exports and runtime assets.
11. Internal package reorganization preserves the public core API and generated application.

## References

- [Doxa architecture](../architecture.md#package-boundaries)
- [Doxa governing dependency rule](../architecture.md#the-governing-dependency-rule)
- [MVP toolchain](0007-mvp-toolchain.md)
- [Path-independent structure and services](0016-path-independent-structure-autowired-services.md)

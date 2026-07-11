# 0007: Use the Accepted MVP Repository and Testing Toolchain

- **Status:** Accepted
- **Accepted:** 2026-07-10
- **Decision owners:** Canopy maintainers

## Decision

The Canopy MVP will use:

- A pnpm workspace.
- Native ECMAScript modules.
- Strict TypeScript.
- Vitest for unit, integration, conformance, generator-fixture, and first-party fake tests.
- Disposable PostgreSQL test containers for persistence and concurrency conformance.
- Packages separated by architectural responsibility.

The initial workspace should contain independently bounded packages for the kernel, HTTP contract,
Hono adapter, persistence contract, Drizzle adapter, authentication, jobs, communications,
observability, testing, and CLI, plus a complete reference application.

## Boundary

Vitest transforms TypeScript but does not replace TypeScript type-checking. CI must run the strict
compiler independently from the test suite.

Package separation must enforce dependency direction rather than create publishing ceremony.
Build tooling may bundle packages for distribution, but source and declarations remain native ESM.

## TypeScript compatibility

Each Canopy release pins exactly one supported TypeScript version across application type-checking,
`@canopy/compiler`, generators, codemods, declaration emit, conformance fixtures, and Cultivate
source inspection. The workspace resolves one TypeScript installation.

Applications upgrade TypeScript through a compatible Canopy release rather than independently.
`canopy doctor` must diagnose version mismatches before compilation. A TypeScript upgrade requires
the compiler, manifest, generated-application, package, and Cultivate conformance suites to pass.

Canopy does not provide best-effort semantic compilation across arbitrary TypeScript releases.

The initial implementation is pinned to TypeScript 6.0.2. TypeScript 7's replacement native
compiler API is currently exposed through an explicitly unstable package entry point. Canopy will
not build its foundational semantic compiler on that unstable boundary; adoption requires an
intentional compatibility release and the complete compiler, manifest, generated-application, and
Cultivate conformance suites.

## References

- [pnpm](https://pnpm.io/)
- [Vitest](https://vitest.dev/)

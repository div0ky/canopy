# `@doxajs/manifest`

> **Controlled-adoption prerelease:** Publicly downloadable under Apache-2.0; Midtown Home
> Improvements is the sole supported consumer. External use is permitted without compatibility,
> support, warranty, roadmap, or production-readiness commitments.

The versioned, serializable, inert manifest contract shared by the Doxa compiler and runtime.
Ordinary applications should use `@doxajs/core` instead of importing this package.

Manifest formats fail closed when compiler and runtime compatibility do not match. The package has
no dependency on application code, runtime construction, or TypeScript compilation.

Format 5 adds the optional application permission-source graph entry, including its exact ability
catalog and execution-scoped dependencies.

See the
[manifest architecture](https://github.com/div0ky/doxajs/blob/main/manifesto/architecture.md) for
the compatibility contract.

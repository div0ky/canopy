# `@doxajs/compiler`

> **Controlled-adoption prerelease:** Publicly downloadable under Apache-2.0; Midtown Home
> Improvements is the sole supported consumer. External use is permitted without compatibility,
> support, warranty, roadmap, or production-readiness commitments.

The fail-closed semantic TypeScript compiler behind Praxis. It analyzes declaration-only Doxa
Applications and Features and emits `.doxa/manifest.json`, `.doxa/registry.mjs`, and compiled
application output.

Compilation owns Feature privacy and `provides` exports, ordinary-service scopes, the optional
application `PermissionSource`, its static ability catalog, and source/policy access composition.

Application code should use `@doxajs/core`; application developers normally invoke this package
through `doxa build` and `doxa dev`.

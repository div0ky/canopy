# `@canopy/compiler`

The fail-closed semantic TypeScript compiler behind Arbor. It analyzes declaration-only Canopy
Applications and Features and emits `.canopy/manifest.json`, `.canopy/registry.mjs`, and compiled
application output.

Application code should use `@canopy/core`; application developers normally invoke this package
through `arbor build` and `arbor dev`.

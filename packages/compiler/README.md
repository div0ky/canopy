# `@doxajs/compiler`

The fail-closed semantic TypeScript compiler behind Praxis. It analyzes declaration-only Doxa
Applications and Features and emits `.doxa/manifest.json`, `.doxa/registry.mjs`, and compiled
application output.

Application code should use `@doxajs/core`; application developers normally invoke this package
through `doxa build` and `doxa dev`.

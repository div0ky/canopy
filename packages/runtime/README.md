# `@doxajs/runtime`

> **Controlled-adoption prerelease:** Publicly downloadable under Apache-2.0; Midtown Home
> Improvements is the sole supported consumer. External use is permitted without compatibility,
> support, warranty, roadmap, or production-readiness commitments.

The artifact-only Doxa runtime. It validates compiled artifacts, constructs the dependency graph,
admits execution scopes, dispatches framework roles, and owns deterministic lifecycle behavior.

The runtime never compiles source. Ordinary Feature and domain code should import `@doxajs/core`,
not this package.

Praxis may boot the named `model-reader` profile for Gnosis. That profile validates the same
artifacts but starts only the transaction provider's declared dependency closure and admits only the
bounded model-record query entrypoint from an authenticated system console execution; it is not a
general partial-application boot mechanism.

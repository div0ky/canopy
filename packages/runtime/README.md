# `@canopy/runtime`

The artifact-only Canopy runtime. It validates compiled artifacts, constructs the dependency graph,
admits execution scopes, dispatches framework roles, and owns deterministic lifecycle behavior.

The runtime never compiles source. Ordinary Feature and domain code should import `@canopy/core`,
not this package.

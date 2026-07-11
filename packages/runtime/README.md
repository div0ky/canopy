# `@doxajs/runtime`

The artifact-only Doxa runtime. It validates compiled artifacts, constructs the dependency graph,
admits execution scopes, dispatches framework roles, and owns deterministic lifecycle behavior.

The runtime never compiles source. Ordinary Feature and domain code should import `@doxajs/core`,
not this package.

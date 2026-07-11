# Changesets

Published Canopy packages use one fixed version while the framework is pre-1.0. Add a Changeset for
every user-visible package change:

```sh
pnpm changeset
```

Choose the smallest accurate bump and explain the developer-visible outcome. Repository-only,
documentation-only, and test-only changes may omit a Changeset when the pull request says why.

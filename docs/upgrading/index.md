# Upgrading Doxa

Doxa packages use one fixed version while the framework is pre-1.0. Upgrade all `@doxajs/*` packages
together.

Before upgrading:

1. Read the GitHub release and package changelog.
2. Commit application and migration state.
3. Install the new fixed package version.
4. Run `doxa build` so manifest compatibility fails before runtime boot.
5. Run `doxa migrate:status`, then `doxa migrate` in a controlled environment.
6. Run the complete application test suite and inspect generated Gnosis knowledge.

Doxa uses forward-only migrations. Downgrading code across a completed schema migration is not
assumed safe. Breaking prerelease changes must include explicit application, manifest, operational,
and migration guidance.

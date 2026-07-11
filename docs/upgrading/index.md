# Upgrading Canopy

Canopy packages use one fixed version while the framework is pre-1.0. Upgrade all `@canopy/*`
packages together.

Before upgrading:

1. Read the GitHub release and package changelog.
2. Commit application and migration state.
3. Install the new fixed package version.
4. Run `arbor build` so manifest compatibility fails before runtime boot.
5. Run `arbor migrate:status`, then `arbor migrate` in a controlled environment.
6. Run the complete application test suite and inspect generated Cultivate knowledge.

Canopy uses forward-only migrations. Downgrading code across a completed schema migration is not
assumed safe. Breaking prerelease changes must include explicit application, manifest, operational,
and migration guidance.

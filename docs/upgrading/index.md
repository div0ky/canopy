# Upgrading Doxa

Doxa packages use one fixed version while the framework is pre-1.0. Praxis upgrades every existing
first-party dependency together, aligns the supported Node and pnpm toolchain, updates the lockfile,
and validates the application with the newly installed CLI.

Preview the exact changes first:

```sh
pnpm doxa upgrade --dry-run
```

Then commit or stash application work and upgrade:

```sh
pnpm doxa upgrade
```

The default target preserves the installed prerelease channel, so an alpha application resolves the
current `alpha` release instead of crossing into another channel. Pin a target when reproducibility
requires it:

```sh
pnpm doxa upgrade --to=0.1.0-alpha.5
```

Applications created before Praxis provided this command need one bootstrap invocation. It runs the
current CLI against the existing application; subsequent upgrades use the locally installed CLI:

```sh
pnpm dlx @doxajs/praxis@alpha upgrade --dry-run
pnpm dlx @doxajs/praxis@alpha upgrade
```

## Safety contract

Praxis:

- refuses to mutate a dirty Git worktree unless `--force` is explicit;
- changes only existing first-party package entries, so it does not silently add capabilities;
- restores `package.json` if `pnpm install` fails and reports that the lockfile or `node_modules`
  may still need a fresh install;
- hands validation to the newly installed Praxis process;
- runs `doxa build` and the read-only `doxa migrate:status`, but never applies migrations;
- runs `pnpm test` when `--verify` is supplied; and
- executes only release-declared, built-in Doxa recipes—never arbitrary registry code.

Use `--skip-migration-status` only when a database is deliberately unavailable. A failed validation
leaves the upgraded packages installed so the application error can be fixed and the named command
rerun.

Doxa uses forward-only migrations. Downgrading code across a completed schema migration is not
assumed safe, and Praxis refuses version downgrades. Read the release notes before applying a
breaking prerelease upgrade; those notes must include explicit application, manifest, operational,
and migration guidance.

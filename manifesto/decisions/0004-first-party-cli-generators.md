# 0004: Provide a First-Party CLI, Installer, and Generators

- **Status:** Accepted
- **Accepted:** 2026-07-10
- **Decision owners:** Canopy maintainers

## Decision

Canopy will provide a first-party command-line interface that creates applications, installs
first-party capabilities, generates framework-aware code, runs operational workflows, and exposes
diagnostics.

The intended experience combines the roles of Laravel's application installer and its Artisan
commands, especially Artisan's `make:*` generators. Canopy will not build a JavaScript package
manager analogous to Composer; it will use the application's supported package manager beneath
Canopy-owned workflows.

## Context

Canopy promises one obvious way to perform ordinary application work. Documentation and runtime
conventions are insufficient if developers must manually reproduce file placement, exports,
manifest registration, tests, migrations, and configuration for every feature.

Generators are also part of framework governance. They encode the architecture Canopy teaches,
make the preferred path inexpensive, and give migrations a reliable way to update conventional
application structure.

Laravel demonstrates both halves of this experience: an installer creates a ready application,
while Artisan `make:*` commands generate models, controllers, jobs, events, listeners, migrations,
policies, tests, and application commands from customizable stubs.

## Command families

The initial CLI vocabulary will use `canopy`:

```text
canopy new <application>
canopy add <capability>
canopy make:<artifact> <name>
canopy db:<operation>
canopy inspect:<surface>
canopy doctor
canopy upgrade
```

The initial project and capability workflows should include:

- `canopy new <application>` creates a complete, bootable application from a versioned first-party
  starter.
- `canopy add auth` installs Canopy authentication schema, routes, configuration, tests, and
  optional UI contracts.
- `canopy add worker` installs the worker runtime and its lifecycle configuration.
- `canopy add scheduler` installs scheduling support.

The initial generators should include:

- `canopy make:feature`
- `canopy make:model`
- `canopy make:action`
- `canopy make:query`
- `canopy make:service`
- `canopy make:controller`
- `canopy make:resource`
- `canopy make:policy`
- `canopy make:event`
- `canopy make:listener`
- `canopy make:observer`
- `canopy make:job`
- `canopy make:migration`
- `canopy make:command`
- `canopy make:test`

Compound generation should be available where the generated artifacts form one coherent feature.
For example:

```text
canopy make:model Order --migration --repository --factory
canopy make:feature Orders --http --persistence --tests
```

The specification must keep compound generation intentional. Canopy should generate a useful
vertical slice, not a large collection of empty architectural layers.

## Generator contract

Every mutating CLI command must:

- Produce deterministic output for the same framework version and inputs.
- Display the files and registrations it will change.
- Support a dry-run or diff mode.
- Refuse to overwrite user code silently.
- Detect ambiguous or conflicting application structure.
- Apply formatting through the project's configured formatter.
- Leave the application manifest and generated registrations valid.
- Report partial failure and recovery steps clearly.
- Be testable against fixtures and real generated applications.
- Record the Canopy version and recipe responsible for generated output.

Generators that edit existing code should prefer a parsed representation or a stable framework
manifest over fragile string replacement. If a safe structural edit cannot be proved, the command
must stop and explain the required manual change.

## Placement and source organization

Generators provide opinionated placement defaults, but folder names have no runtime meaning.
Commands must accept or infer the owning Feature, create direct TypeScript imports, and update its
role arrays where the artifact is framework-facing. A generated ordinary service is discovered
through constructor reachability and is not added to a Feature role array.

Generated source follows Canopy's accepted defaults: kebab-case filenames, PascalCase classes, one
primary framework-facing class per file, no required barrel files, colocated unit tests, and
Feature or integration tests under `tests/` where appropriate.

Generators and structural edits must preserve valid custom layouts. Moving from role-first to
domain-first, Feature-first, or package-based organization must not require Canopy runtime
configuration.

## Editable and owned files

Generated files fall into two categories:

1. **Application-owned output** is created once and may be freely edited. Future generator runs
   must treat it as user code.
2. **Canopy-owned output** is reproducible from a manifest, clearly marked, and never manually
   edited.

The CLI must not regenerate application-owned files during an upgrade. Upgrades use explicit
codemods, migration guides, and reviewable diffs.

## Starters, recipes, and stubs

A versioned starter defines the minimum complete application produced by `canopy new`. A recipe
adds one coherent capability to an existing application. A stub defines an editable source
artifact produced by a `make:*` command.

Initially:

- Canopy ships and supports first-party starters and recipes only.
- Recipes declare prerequisites, package changes, schema changes, file operations, and
  verification commands.
- Recipe execution is transactional where possible and reports an exact recovery plan otherwise.
- Applications may publish and customize generator stubs through a command such as
  `canopy stubs:publish`.
- Customized stubs are versioned application code and are not silently replaced on upgrade.

Third-party recipe execution is deferred until Canopy can provide provenance, permissions,
sandboxing, and reviewable operations. A generator is code execution and must be treated as a
supply-chain boundary.

## Package-manager boundary

Canopy does not replace npm, pnpm, or another supported JavaScript package manager. The CLI owns
the intent—create an application or install a capability—and delegates dependency resolution and
lockfile updates to the selected package manager.

Package-manager invocation must be explicit in diagnostics, reproducible, and compatible with
non-interactive environments. Canopy releases pin their curated dependency set even though a
package manager performs the installation.

## Operational commands

The CLI is more than a scaffolder. It is the public tooling surface for the application model and
should eventually expose:

- Route, handler, listener, observer, job, and schedule listings.
- Dependency-graph and execution-scope inspection.
- Configuration and secret validation.
- Database migration generation, application, and status.
- Worker and scheduler operation.
- Framework health and compatibility diagnostics.
- Test environment setup.
- Safe framework upgrade planning and codemods.

These commands must consume the same application manifest and lifecycle contracts as the runtime.
The CLI must not invent a second interpretation of the application.

The canonical `.canopy/` manifest and registry are generated, gitignored build output. Development,
build, test, inspection, and packaging commands generate or require current artifacts and never
ask developers to edit or commit them. CI must be able to prove deterministic regeneration from
committed source.

Production runtime does not compile TypeScript or generate manifests. Official CLI workflows own
that work before boot, and missing or invalid artifacts must produce an actionable regeneration
diagnostic rather than trigger runtime compilation.

## Consequences

- Tooling becomes a first-class package and compatibility surface from the beginning.
- Framework conventions can be taught through generated, working vertical slices.
- Starters and generators require fixture, snapshot, boot, and upgrade testing across supported
  configurations.
- Generated code quality becomes part of Canopy's product quality.
- The CLI must preserve user edits and dirty worktrees carefully.
- Canopy avoids building a package manager while still presenting one coherent installation
  experience.

## Required implementation proof

The first tooling proof must demonstrate:

1. `canopy new` produces an application that installs, boots, tests, and shuts down.
2. `canopy add auth` safely adds the first-party authentication subsystem and migrations.
3. A compound feature generator creates a working vertical slice rather than disconnected files.
4. Dry-run output matches the actual file and package changes.
5. Repeated execution is idempotent or fails with a precise conflict.
6. Existing user edits are never overwritten silently.
7. Generated manifests pass runtime boot validation.
8. Starters and recipes are locked to compatible Canopy releases.
9. Failure during generation leaves a recoverable worktree.
10. CI can run every command non-interactively.

## Revisit when

- The generator vocabulary encourages architecture that conflicts with real application needs.
- Structural source edits cannot be made safely enough to preserve user trust.
- Package-manager differences prevent reproducible installation through one CLI contract.
- Supporting a recipe ecosystem would compromise the curated compatibility or supply-chain model.

## References

- [Canopy Manifesto: desired programming experience](../index.md#the-desired-programming-experience)
- [Canopy Manifesto: what Canopy should make automatic](../index.md#what-canopy-should-make-automatic)
- [Path-independent structure and autowired services](0016-path-independent-structure-autowired-services.md)
- [Laravel Artisan documentation](https://laravel.com/docs/13.x/artisan)
- [Laravel starter kits](https://laravel.com/docs/13.x/starter-kits)
- [Laravel Eloquent generators](https://laravel.com/docs/13.x/eloquent)

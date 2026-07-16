# Doxa Contributor Guidance

These instructions apply to the entire repository.

## Authority

- `manifesto/principles.md` defines the framework character.
- Accepted records under `manifesto/decisions/` govern settled architecture.
- Specifications define normative behavior; implementation proofs describe verified behavior.
- Do not silently change a settled public contract. Add or amend a decision first.

## Required workflow

- Read the package boundary and the relevant specification before editing.
- Preserve stable IDs, fail-closed compilation, artifact-only runtime boot, one execution scope,
  automatic HTTP envelopes, and first-party security ownership.
- Use `apply_patch` for deliberate source edits.
- Add focused regression evidence, then run `pnpm verify` before claiming completion.
- Do not commit generated `dist`, `.doxa`, coverage, local environment, or package archives.
- Do not edit unrelated worktree changes.

## Documentation consistency

- Treat documentation as part of the change. When behavior, a public contract, capability status,
  CLI output, package support, or an operational workflow changes, update every affected
  specification, accepted decision, implementation proof, completion ledger, guide, README, and
  release note or changeset in the same change.
- Keep `manifesto/specifications.md` and `manifesto/implementation/mvp-completion-ledger.md`
  synchronized whenever aggregate acceptance status changes. Historical vertical-slice status must
  be clearly identified as historical and must not contradict the current aggregate status.
- Before claiming completion, search for stale status labels, superseded terminology, old commands,
  and contradictory descriptions across `manifesto/`, `docs/`, examples, and package READMEs.
- Run documentation formatting and link validation as part of `pnpm verify`; do not treat passing
  code tests as sufficient when required documentation is stale or missing.

## Application-facing design

Doxa is opinionated, magical where safe, trivial for Gnosis to understand, and difficult to misuse.
Framework-facing classes extend their Doxa role and use `this.inject()`. Ordinary services are plain
classes with constructor injection. Folder names never carry runtime meaning.

When equally viable designs exist, choose the one with better developer experience while retaining
determinism, inspection, security, and clear failure behavior.

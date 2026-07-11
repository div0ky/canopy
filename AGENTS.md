# Canopy Contributor Guidance

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
- Do not commit generated `dist`, `.canopy`, coverage, local environment, or package archives.
- Do not edit unrelated worktree changes.

## Application-facing design

Canopy is opinionated, magical where safe, trivial for Cultivate to understand, and difficult to
misuse. Framework-facing classes extend their Canopy role and use `this.inject()`. Ordinary services
are plain classes with constructor injection. Folder names never carry runtime meaning.

When equally viable designs exist, choose the one with better developer experience while retaining
determinism, inspection, security, and clear failure behavior.

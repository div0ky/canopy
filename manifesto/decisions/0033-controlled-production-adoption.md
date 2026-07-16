# 0033: Use a Closed, Controlled Production Adoption Program

- **Status:** Accepted
- **Accepted:** 2026-07-16
- **Scope:** Distribution, support, maturity, ownership, and release policy
- **Decision owner:** div0ky

## Decision

Doxa is independently owned and maintained by div0ky. It is undergoing controlled production
adoption, with Midtown Home Improvements as its sole supported consumer. Its npm prereleases are
publicly downloadable under Apache-2.0, but external adoption, compatibility, support, and
production-readiness commitments are not currently offered.

The source and packages are public. The adoption program, supported-consumer relationship, and
development roadmap are closed. Public availability does not make an external installation a
supported deployment.

## Maturity stages

- **Alpha** is architectural development. It may be used for development, prototypes, shadow
  traffic, and disposable production experiments. Breaking APIs and schema rebaselines remain
  routine.
- **Controlled production beta** begins when Midtown uses Doxa in real production. Breaking changes
  remain possible, but each requires a coordinated application, data, job, and deployment migration.
  Midtown remains the sole supported consumer.
- **1.0** means Doxa is heavily relied upon by primary production systems and has earned operational
  trust through sustained real-world use. Upgrades must have succeeded repeatedly, foundational
  rewrites must have settled, and spontaneous breaking changes are no longer acceptable.

Public npm availability does not change these stages. “Closed” identifies who participates in the
supported adoption program, not who can download an Apache-licensed tarball.

## Package and release boundary

- Workspace packages remain separate to enforce dependency direction, production closure, adapter
  isolation, and architectural boundaries.
- First-party packages use one coordinated Doxa version and one tested compatibility set.
- Praxis installs and upgrades the correct package set so application developers experience one
  framework rather than an eighteen-package compatibility exercise.
- Prereleases remain on the `alpha` or `beta` channel. A stable `latest` release waits for the 1.0
  maturity bar.
- Incorrect alpha APIs may be removed or renamed. Once a production application depends on durable
  data, jobs, events, credentials, or stable IDs, changes to those records require explicit
  migration and rollout evidence regardless of the package label.

## Support and security boundary

- Midtown is currently the only supported production consumer.
- External use and forks are permitted by Apache-2.0, but receive no compatibility, support,
  warranty, roadmap, or production-readiness commitment.
- Security review follows exposed production risk during alpha and beta. Authentication,
  authorization, tenant boundaries, communications, queue recovery, diagnostics, and other deployed
  trust boundaries are reviewed before they carry corresponding production responsibility.
- The independent security review remains required before Doxa claims 1.0 production stability.

## Ownership boundary

Doxa is not owned or maintained by Midtown. Midtown owns its applications, business logic, data,
configuration, infrastructure, and company-specific integrations; none belong in Doxa's public
repository or npm artifacts.

The project records its ownership position in [`OWNERSHIP.md`](../../OWNERSHIP.md). Because
employment and work-made-for-hire rules can depend on facts and agreements outside this repository,
that project statement does not replace written confirmation between the affected parties.

## Consequences

- Doxa can evolve aggressively while its architecture is still being proven.
- Production compatibility effort is spent on real Midtown applications and durable state rather
  than hypothetical consumers.
- Public download counts or outside experiments do not expand the supported surface.
- 1.0 is earned by sustained primary-system reliance, successful upgrades, security evidence, and
  operational trust rather than by a marketing deadline.

## References

- [Doxa ownership](../../OWNERSHIP.md)
- [Support policy](../../SUPPORT.md)
- [Security model](../security.md)
- [Public package surface](0018-public-package-surface.md)

# Name the framework Doxa.js

## Status

Accepted on 2026-07-11.

## Decision

The framework, its public package organization, programming model, documentation, generated
artifacts, framework-owned identifiers, environment variables, and persistence namespaces use the
**Doxa.js** identity. The framework is called **Doxa** in code and conversation.

The canonical npm scope is `@doxajs`, and the canonical web identity is `doxajs.com`. Praxis is the
command and generator suite, Theoria is the development debugger, and Gnosis is the AI-assisted
engineering product. The earlier Caffeine name is retired.

## Context

The original Canopy name captured the framework's forest identity, but its npm organization was
unavailable. Sylora briefly supplied an available namespace, but its woodland association described
the aesthetic more strongly than the framework's defining conviction.

The Greek _doxa_ means opinion, belief, or reputation. That meaning directly expresses an
opinionated framework that chooses the right ordinary path so application developers spend more time
building and less time assembling infrastructure. The public spelling Doxa.js identifies the
JavaScript ecosystem, aligns exactly with `@doxajs` and `doxajs.com`, and contains the creator's
initials, AJS, as a quiet signature rather than a personal package namespace.

The bare word Doxa has existing commercial uses, including software uses. The project accepts that
early naming risk deliberately. Doxa.js has a distinct audience, presentation, package namespace,
and product category. If future scale makes a conflict material, the project expects to have better
resources and an established community through which a later rename can be communicated and
migrated. This record is a product decision, not a claim of trademark clearance.

## Boundary

This is a deliberate replacement, not a display-name overlay:

- Packages use `@doxajs/*`.
- Public framework types use `Doxa` names.
- Generated artifacts live under `.doxa/`.
- Framework-owned IDs and environment variables use `doxa` and `DOXA` prefixes.
- First-party database objects use `doxa_` prefixes.
- Examples, commands, documentation, diagnostics, and package metadata teach Doxa.js as the brand
  and Doxa as the programming name.

Historical compatibility aliases for `Canopy`, `@canopy/*`, `.canopy`, or `canopy_*` are explicitly
out of scope before the first public release. If published adopters later require a rename, that
would need a separate migration and deprecation decision.

## Consequences

- Application code and package installation present one coherent public identity.
- Gnosis has one unambiguous vocabulary and package graph to teach.
- Local databases and generated artifacts from pre-rename development must be recreated or migrated
  manually; they are not a supported public upgrade surface.
- Repository hosting may move independently, but published package metadata must use the Doxa.js
  repository name and must never revert to Canopy branding.

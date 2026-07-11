# Container Deployment Vertical Slice

- **Status:** Implemented proof
- **Manifest format:** 11
- **Completed:** 2026-07-11

Canopy applications now generate one multi-stage, non-root production image and specialize that
image by command. The default topology is `arbor serve` for horizontally scalable web replicas,
`arbor work` for horizontally scalable workers plus distributed schedule admission, and
`arbor migrate` as an explicit one-off release job. `arbor work --without-scheduler` with a separate
`arbor schedule` process remains the advanced isolation topology.

Production runtime and application commands load `dist/application.js`, `.canopy/manifest.json`, and
`.canopy/registry.mjs` directly. They never invoke TypeScript or the Canopy compiler during process
startup and fail closed with a build diagnostic when artifacts are missing or incompatible.
Background roles remain alive until a host signal even when an installed queue provider owns no
active event-loop resource, then drain through the normal idempotent runtime shutdown path.

`arbor new` generates `Dockerfile`, `.dockerignore`, and `compose.production.yaml`. The Compose
example builds one shared image, exposes an application-owned web health endpoint, keeps migrations
out of service startup, passes secrets only through runtime environment, and runs web, background,
and migration roles from the same image. Cultivate exposes the same topology, build boundary,
scheduler guarantees, advanced isolation commands, and safety invariants as structured knowledge.

Executable evidence lives in `tests/arbor.test.ts`. It proves generated files and Cultivate agree,
missing artifacts fail closed, and real child processes boot every background topology from prebuilt
artifacts after source and compiler access have been removed. Dockerfile static validation and
rendered Compose validation complete the container-shaped proof.

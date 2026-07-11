# Container Deployment Vertical Slice

- **Status:** Implemented proof
- **Manifest format:** 11
- **Completed:** 2026-07-11

Doxa applications now generate one multi-stage, non-root production image and specialize that image
by command. The default topology is `doxa serve` for horizontally scalable web replicas, `doxa work`
for horizontally scalable workers plus distributed schedule admission, and `doxa migrate` as an
explicit one-off release job. `doxa work --without-scheduler` with a separate `doxa schedule`
process remains the advanced isolation topology.

Production runtime and application commands load `dist/application.js`, `.doxa/manifest.json`, and
`.doxa/registry.mjs` directly. They never invoke TypeScript or the Doxa compiler during process
startup and fail closed with a build diagnostic when artifacts are missing or incompatible.
Background roles remain alive until a host signal even when an installed queue provider owns no
active event-loop resource, then drain through the normal idempotent runtime shutdown path.

`doxa new` generates `Dockerfile`, `.dockerignore`, and `compose.production.yaml`. The Compose
example builds one shared image, exposes an application-owned web health endpoint, keeps migrations
out of service startup, passes secrets only through runtime environment, and runs web, background,
and migration roles from the same image. Gnosis exposes the same topology, build boundary, scheduler
guarantees, advanced isolation commands, and safety invariants as structured knowledge.

Executable evidence lives in `tests/praxis.test.ts`. It proves generated files and Gnosis agree,
missing artifacts fail closed, and real child processes boot every background topology from prebuilt
artifacts after source and compiler access have been removed. Dockerfile static validation and
rendered Compose validation complete the container-shaped proof.

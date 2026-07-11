# Arbor Command Kernel Vertical Slice

- **Status:** Implemented proof
- **Working name:** Arbor
- **Completed:** 2026-07-10

`@canopy/arbor` provides Canopy's first-party Artisan-like command suite. The canonical executable
is `arbor`, exposed in this workspace through `pnpm arbor`.

Arbor implements application creation; every canonical `make:*` role; compilation; migrations;
serve, worker, scheduler, combined development, and test processes; application commands; graph
and role inspection; Cultivate metadata; and queue, delivery, auth, journal, outbox, cache, and
schedule operations. Generators use the canonical Feature declaration, add imports and role-array
entries automatically, reject overwrites, and require every generated entry point to choose
`--public` or `--ability=...`. That safety choice makes the beautiful path the secure path.

Manual schedule firing uses the transactional outbox instead of starting an incidental scheduler
inside the command. It is therefore durable even when workers are offline. Schedule enablement is
stored in PostgreSQL and reconciled by the scheduler role. Arbor is the accepted ecosystem name.

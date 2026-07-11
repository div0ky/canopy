# Praxis Command Kernel Vertical Slice

- **Status:** Implemented proof
- **Working name:** Praxis
- **Completed:** 2026-07-10

`@doxajs/praxis` provides Doxa's first-party Artisan-like command suite. The canonical executable is
`doxa`, exposed in this workspace through `pnpm doxa`.

Praxis implements application creation; every canonical `make:*` role; compilation; migrations;
serve, worker, scheduler, combined development, and test processes; application commands; graph and
role inspection; Gnosis metadata; and queue, delivery, auth, journal, outbox, cache, and schedule
operations. `doxa db:studio` launches the framework-pinned Drizzle Studio using the declared `.env`
database without placing credentials in command arguments. Generators use the canonical Feature
declaration, add imports and role-array entries automatically, reject overwrites, and require every
generated entry point to choose `--public` or `--ability=...`. That safety choice makes the
beautiful path the secure path.

Manual schedule firing uses the transactional outbox instead of starting an incidental scheduler
inside the command. It is therefore durable even when workers are offline. Schedule enablement is
stored in PostgreSQL and reconciled by the scheduler role. Praxis is the accepted ecosystem name.

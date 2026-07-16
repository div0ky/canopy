# `@doxajs/postgres-drizzle`

> **Controlled-adoption prerelease:** Publicly downloadable under Apache-2.0; Midtown Home
> Improvements is the sole supported consumer. External use is permitted without compatibility,
> support, warranty, roadmap, or production-readiness commitments.

Doxa's first-party PostgreSQL transaction, durability, Eloquent-style model persistence, journal,
outbox, communications ledger, and cache adapter implemented with Drizzle.

```sh
pnpm add @doxajs/postgres-drizzle
```

The package includes forward-only Doxa-owned migrations. Application models and domain code remain
independent from Drizzle types.

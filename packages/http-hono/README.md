# `@doxajs/http-hono`

> **Controlled-adoption prerelease:** Publicly downloadable under Apache-2.0; Midtown Home
> Improvements is the sole supported consumer. External use is permitted without compatibility,
> support, warranty, roadmap, or production-readiness commitments.

Doxa's first-party Hono-backed HTTP engine and lifecycle-coordinated Node host. Hono remains an
adapter implementation detail; applications declare routes through `@doxajs/core`.

```sh
pnpm add @doxajs/http-hono
```

Most applications receive this adapter through the Praxis-generated composition boundary.

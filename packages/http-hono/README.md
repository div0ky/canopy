# `@canopy/http-hono`

Canopy's first-party Hono-backed HTTP engine and lifecycle-coordinated Node host. Hono remains an
adapter implementation detail; applications declare routes through `@canopy/core`.

```sh
pnpm add @canopy/http-hono
```

Most applications receive this adapter through the Arbor-generated composition boundary.

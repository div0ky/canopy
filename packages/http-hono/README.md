# `@doxajs/http-hono`

Doxa's first-party Hono-backed HTTP engine and lifecycle-coordinated Node host. Hono remains an
adapter implementation detail; applications declare routes through `@doxajs/core`.

```sh
pnpm add @doxajs/http-hono
```

Most applications receive this adapter through the Praxis-generated composition boundary.

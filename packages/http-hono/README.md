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

Inbound request bodies are bounded before route admission. `HonoHttpEngine` and `HonoHttpHost`
default to 1 MiB and accept an explicit byte limit when the application needs a different maximum:

```ts
new HonoHttpEngine(runtime, { maxRequestBodyBytes: 2 * 1024 * 1024 })
```

Malformed `Content-Length` is rejected with `400 invalid_content_length`; declared or streamed
over-limit bodies receive the canonical `413 payload_too_large` envelope.

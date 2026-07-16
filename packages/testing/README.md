# `@doxajs/testing`

> **Controlled-adoption prerelease:** Publicly downloadable under Apache-2.0; Midtown Home
> Improvements is the sole supported consumer. External use is permitted without compatibility,
> support, warranty, roadmap, or production-readiness commitments.

The first-party test harness for Doxa applications. It boots real compiled manifests with safe
provider overrides and supplies HTTP, authentication, persistence, queue, schedule, cache,
communications, observation, logging, and telemetry fakes.

```sh
pnpm add -D @doxajs/testing vitest
```

Test-only behavior stays outside `@doxajs/core` and production applications.

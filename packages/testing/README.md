# `@canopy/testing`

The first-party test harness for Canopy applications. It boots real compiled manifests with safe
provider overrides and supplies HTTP, authentication, persistence, queue, schedule, cache,
communications, observation, logging, and telemetry fakes.

```sh
pnpm add -D @canopy/testing vitest
```

Test-only behavior stays outside `@canopy/core` and production applications.

# `@doxajs/testing`

The first-party test harness for Doxa applications. It boots real compiled manifests with safe
provider overrides and supplies HTTP, authentication, persistence, queue, schedule, cache,
communications, observation, logging, and telemetry fakes.

```sh
pnpm add -D @doxajs/testing vitest
```

Test-only behavior stays outside `@doxajs/core` and production applications.

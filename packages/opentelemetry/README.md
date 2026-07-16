# `@doxajs/opentelemetry`

> **Controlled-adoption prerelease:** Publicly downloadable under Apache-2.0; Midtown Home
> Improvements is the sole supported consumer. External use is permitted without compatibility,
> support, warranty, roadmap, or production-readiness commitments.

This adapter exports Doxa's runtime-owned spans and metrics through the globally registered
OpenTelemetry API. Initialize an OpenTelemetry SDK before booting Doxa, then install this package as
an application plugin. Application roles never import OpenTelemetry types.

```ts
export class Application extends DoxaApplication {
  plugins = ['@doxajs/opentelemetry'] as const
}
```

Doxa logging remains independent because OpenTelemetry JavaScript logs are not yet a stable signal.

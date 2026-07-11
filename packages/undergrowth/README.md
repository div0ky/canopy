# `@canopy/undergrowth`

Undergrowth is Canopy's optional first-party development debugger. It records redacted correlated
observations in PostgreSQL and exposes a read-only loopback explorer for requests, operations,
models, events, jobs, schedules, logs, and exceptions.

```sh
arbor add undergrowth
arbor migrate
arbor undergrowth
```

Undergrowth is disabled in production unless explicitly overridden.

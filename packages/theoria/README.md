# `@doxajs/theoria`

Theoria is Doxa's optional first-party development debugger. It records redacted correlated
observations in PostgreSQL and exposes a read-only loopback explorer for requests, operations,
models, events, jobs, schedules, logs, and exceptions.

```sh
doxa add theoria
doxa migrate
doxa theoria
```

Theoria is disabled in production unless explicitly overridden.

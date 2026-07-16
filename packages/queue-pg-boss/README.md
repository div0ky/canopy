# `@doxajs/queue-pg-boss`

Doxa's first-party PostgreSQL queue, outbox handoff, worker, retry, failure, schedule, and operator
adapter implemented with pg-boss.

```sh
pnpm add @doxajs/queue-pg-boss
```

Delivery is at least once. Jobs must be idempotent. Multiple background replicas may safely admit
schedules because cron declarations and interval slots use distributed identities.

`doxa migrate` installs queue-owned schedule controls and short-lived attempt-trace lineage used to
link retries across worker processes. Terminal jobs remove their attempt lineage, and orphaned rows
expire defensively.

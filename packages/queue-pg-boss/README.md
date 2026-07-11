# `@canopy/queue-pg-boss`

Canopy's first-party PostgreSQL queue, outbox handoff, worker, retry, failure, schedule, and
operator adapter implemented with pg-boss.

```sh
pnpm add @canopy/queue-pg-boss
```

Delivery is at least once. Jobs must be idempotent. Multiple background replicas may safely admit
schedules because cron declarations and interval slots use distributed identities.

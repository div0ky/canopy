# Events, Jobs, and Schedules

## Events

Declare an Event in a Feature, import its class anywhere inside the allowed application boundary,
and dispatch it statically:

```ts
await UserRegistered.dispatch({ userId: user.id })
```

Listeners declare their event through their generic type. Marker interfaces select local,
after-commit, queued, or queued-after-commit delivery without runtime decorators.

## Jobs

Jobs use the same class-first dispatch experience:

```ts
const jobId = await SendWelcomeEmail.dispatch(
  { userId: user.id },
  { idempotencyKey: `welcome:${user.id}` },
)
```

Doxa guarantees at-least-once execution. Jobs should be idempotent and may declare retries, backoff,
delay, timeout, and overlap behavior. Actor, tenant, authentication, correlation, causation, and
trace context cross the durable boundary.

## Schedules

Schedules target Jobs rather than inventing a second execution model. They may use cron or fixed
interval declarations and define overlap and misfire policy.

`doxa work` consumes queues and admits distributed-safe schedules by default. Advanced deployments
may run `doxa work --without-scheduler` beside a dedicated `doxa schedule` process.

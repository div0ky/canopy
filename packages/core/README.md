# `@doxajs/core`

> **Controlled-adoption prerelease:** Publicly downloadable under Apache-2.0; Midtown Home
> Improvements is the sole supported consumer. External use is permitted without compatibility,
> support, warranty, roadmap, or production-readiness commitments.

The primary application-facing programming model for Doxa. Application Features import roles,
models, events, jobs, schedules, policies, configuration, ports, and public contracts from this
package.

```sh
pnpm add @doxajs/core
```

```ts
import { Feature, Route, type HttpRequest } from '@doxajs/core'

export class HomeRoute extends Route {
  static override readonly id = 'home'
  static override readonly access = 'public'
  readonly method = 'GET'
  readonly path = '/'
  handle(_request: HttpRequest) {
    return { application: 'shop' }
  }
}

export class AppFeature extends Feature {
  id = 'app'
  routes = [HomeRoute]
}
```

Doxa contributes mandatory infrastructure, authentication routes, and `GET /health` from
framework-owned generated declarations. Application Features do not re-declare them.

## Models

Persistent models expose typed cloned reads and writes while keeping their raw attribute bag
protected:

```ts
const customer = await Customer.findOrFail(input.id)

customer.setAttribute('email', input.email)
customer.fill({ displayName: input.displayName, phone: input.phone })

if (customer.isDirty()) await customer.save()
```

`setAttribute` and `fill` clone incoming values, mark ordinary dirty state, and never save
implicitly. `id` cannot be changed after construction. Use intention-revealing model methods for
changes that enforce invariants or raise domain events, journal facts, or outbox messages.

See the [Doxa repository](https://github.com/div0ky/doxajs) for documentation and support.

## Broadcasting

```ts
import { Event, PrivateChannel, type ShouldBroadcast } from '@doxajs/core'

export class OrderShipped extends Event<{ orderId: string }> implements ShouldBroadcast {
  static override readonly id = 'order-shipped'
  broadcastOn() {
    return new PrivateChannel(`orders.${this.payload.orderId}`)
  }
}
```

Queued broadcasts use the Unit of Work outbox automatically. Use `ShouldBroadcastNow` only when the
publisher must synchronously observe transport success or failure.

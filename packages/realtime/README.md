# `@doxajs/realtime`

> **Controlled-adoption prerelease:** Publicly downloadable under Apache-2.0; Midtown Home
> Improvements is the sole supported consumer. External use is permitted without compatibility,
> support, warranty, roadmap, or production-readiness commitments.

Typed, reconnecting subscriptions for Doxa broadcasts.

```ts
const realtime = new Realtime({ url: 'ws://127.0.0.1:6001/app' })
realtime
  .private<{ 'order.shipped': { orderId: string } }>('orders.42')
  .listen('order.shipped', ({ orderId }) => console.log(orderId))
```

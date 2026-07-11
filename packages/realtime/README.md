# `@doxajs/realtime`

Typed, reconnecting subscriptions for Doxa broadcasts.

```ts
const realtime = new Realtime({ url: 'ws://127.0.0.1:6001/app' })
realtime
  .private<{ 'order.shipped': { orderId: string } }>('orders.42')
  .listen('order.shipped', ({ orderId }) => console.log(orderId))
```

# `@doxajs/keryx`

Keryx is Doxa's first-party WebSocket broadcasting server. Application events and subscribers use
the provider-independent contracts in `@doxajs/core` and `@doxajs/realtime`.

```ts
import { Keryx } from '@doxajs/keryx'

export class ApplicationBroadcasting extends Keryx {
  static override readonly id = 'broadcasting'
  constructor() {
    super({ port: 6001 })
  }
}
```

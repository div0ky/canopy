# `@canopy/core`

The stable, application-facing programming model for Canopy. Application Features import roles,
models, events, jobs, schedules, policies, configuration, ports, and public contracts from this
package.

```sh
pnpm add @canopy/core
```

```ts
import { Feature, Route, type HttpRequest } from '@canopy/core'

export class HealthRoute extends Route {
  static override readonly id = 'health'
  static override readonly access = 'public'
  readonly method = 'GET'
  readonly path = '/health'
  handle(_request: HttpRequest) {
    return { status: 'ok' }
  }
}

export class AppFeature extends Feature {
  id = 'app'
  routes = [HealthRoute]
}
```

See the [Canopy repository](https://github.com/div0ky/canopy) for documentation and support.

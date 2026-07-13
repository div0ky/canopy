# Application Model

A Doxa Application is a root `app.config.ts` declaration of selected user Features, optional
plugins, and typed framework configuration. Doxa automatically adds its mandatory core Feature for
HTTP, PostgreSQL persistence, transactions, cache, pg-boss queues/scheduling, authentication, and
health. A user Feature declares only application classes that face the framework: models, actions,
queries, routes, events, listeners, signals, observers, jobs, schedules, policies, commands, and
configuration.

```ts
export class OrdersFeature extends Feature {
  id = 'orders'
  models = [Order]
  actions = [PlaceOrder]
  routes = [PlaceOrderRoute]
  events = [OrderPlaced]
  listeners = [ReserveInventory]
  policies = [OrderPolicy]
}
```

Framework roles extend their Doxa role and receive execution-scoped dependencies through
`this.inject()`. They do not need constructors or manual `super()` calls.

```ts
export class RegisterRoute extends Route {
  private readonly actions = this.inject(ActionBus)
}
```

Events and signals are payload roles created inside an admitted execution. They may use
`this.inject()` and their inherited logger; their payload constructor is not dependency injection.
Schedules are different: they are declaration-only timing metadata, are never constructed, and
dispatch a Job that receives the schedule firing's execution scope.

Ordinary services remain plain classes with constructor injection. Concrete services are directly
shareable when the declaring Feature exposes them; abstract-class ports or typed tokens are added
when polymorphism or isolation is meaningful.

Every admitted request, job, schedule, command, listener, or message receives one execution scope
with the same actor, authentication, tenant, correlation, causation, trace, cancellation, logging,
transaction, and disposal semantics. A new scope begins only across an asynchronous admission
boundary.

The compiler reads declarations without executing application code and emits an inert JSON manifest
plus a constructor-only registry. Runtime boot fails closed when artifacts, versions, stable IDs,
providers, authorization, or dependency relationships are invalid.

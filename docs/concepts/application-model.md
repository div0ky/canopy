# Application Model

A Doxa Application is a declaration of selected Features. A Feature declares only the classes that
face the framework: models, actions, queries, routes, events, listeners, signals, observers, jobs,
schedules, policies, commands, configuration, and infrastructure providers.

```ts
export class AccountsFeature extends Feature {
  id = 'accounts'
  models = [User]
  actions = [RegisterUser]
  routes = [RegisterRoute]
  events = [UserRegistered]
  listeners = [SendWelcomeEmail]
  policies = [UserPolicy]
}
```

Framework roles extend their Doxa role and receive execution-scoped dependencies through
`this.inject()`. They do not need constructors or manual `super()` calls.

```ts
export class RegisterRoute extends Route {
  private readonly actions = this.inject(ActionBus)
}
```

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

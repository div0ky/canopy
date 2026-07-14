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

## Models and queries

Models expose immutable, typed Doxa queries over logical attribute names. Drizzle remains private to
the PostgreSQL adapter.

```ts
const contacts = await Contact.where({ ownerId }).get()
const appointments = await Appointment.where({ contactId }).orderBy('scheduledAt').get()

const page = await Contact.where({ ownerId }).paginate({ page: 1, perPage: 50 })
const cursorPage = await Appointment.query().orderBy('scheduledAt').cursorPaginate({ first: 100 })
```

Start with `Model.query()` when the inherited static convenience does not name the first operation:

```ts
const matches = await Contact.query()
  .where((query) => query.where({ active: true }).orWhere({ invited: true }))
  .whereIn('status', ['active', 'pending'])
  .orderByDesc('createdAt')
  .get()
```

Queries also provide `first`, `firstOrFail`, `exists`, `count`, `value`, `pluck`, `min`, `max`,
`sum`, `average`, offset pagination, opaque cursor pagination, and bounded async cursor iteration.
Actions and jobs query models through their writable transaction. Query handlers receive the same
identity-mapped model experience through a read-only session; `create`, `save`, and `delete` throw
`ReadOnlyExecutionError` there.

## Relationships and eager loading

Declare relationships with Doxa model references and logical keys. Pivot-backed many-to-many
relationships use a declared pivot model, so declarations never import database tables.

```ts
export interface PostRelations {
  author: User
  comments: readonly Comment[]
}

export class Post extends Model<PostAttributes, PostRelations> {
  static relationships = {
    author: belongsTo(() => User, { foreignKey: 'authorId' }),
    comments: hasMany(() => Comment, { foreignKey: 'postId' }),
  }

  get author(): User {
    return this.related('author')
  }

  get comments(): readonly Comment[] {
    return this.related('comments')
  }
}
```

Use `with` for bounded eager loading. It supports multiple, nested, and constrained relationships;
unloaded relationship access fails instead of silently causing an N+1 query.

```ts
const posts = await Post.with(['author', 'comments']).get()
const nested = await Post.with('comments.author').get()
const approved = await Post.query()
  .with({ comments: (query) => query.where({ approved: true }).orderBy('createdAt') })
  .whereHas('comments', (query) => query.where({ approved: true }))
  .get()
```

Declared observers remain the only model lifecycle hook surface, including `retrieved`, `updating`,
`updated`, and `committed`. Model-query bulk mutation and a public projection-style `join` API are
deliberately deferred; query matching models inside an action and call instance behavior plus
`save()` when observer and model lifecycle semantics are required.

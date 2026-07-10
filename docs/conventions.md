# Conventions

## Dependency rules

Normal feature code may import Canopy application APIs and runtime-neutral feature contracts.

Direct imports of the following are restricted to composition or infrastructure:

- Prisma and generated database clients
- `@nestjs/cqrs`
- BullMQ
- Redis clients
- Twilio, SendGrid, Ably, AWS, OpenAI, and other vendor SDKs

Nest transport decorators remain acceptable in controllers and gateways. Nest dependency
injection may be re-exported by Canopy so feature services do not need a second import vocabulary.

## Naming

- Actions use an imperative business verb: `ApproveQuoteAction`.
- Queries describe the returned information: `GetQuoteQuery`, `ListQuotesQuery`.
- Events use past tense: `QuoteApproved`.
- Listeners describe their effect: `SendQuoteApprovedNotification`.
- Jobs describe work, not timing: `ExpireStaleQuotesJob`.
- Schedules describe cadence/selection and dispatch a job.
- Policies use domain abilities such as `view`, `approve`, or `cancel`.
- Persistence ports use domain language; concrete adapters include their technology.

Avoid generic `Process`, `Handle`, `UpdateData`, or `Manager` names when the domain provides a more
precise term.

## File organization

Organize primarily by bounded context or feature, then by framework role. Do not create a global
folder containing every action in the application.

Keep an action and its handler together when that improves discoverability. Split large files when
the behavior, tests, or dependencies become difficult to scan.

Infrastructure adapters may live in a feature's composition directory when they are feature-
specific. Shared drivers belong in the framework or application infrastructure package.

## Action conventions

- Inputs are immutable.
- Return types are explicit.
- Authorization is visible.
- Transactional behavior is delegated to the unit of work or an explicit transaction boundary.
- Remote work is deferred until after commit or queued.
- Handlers do not return raw Prisma rows.

## Query conventions

- Queries do not mutate state.
- Pagination is cursor-based for changing datasets.
- Data scope is applied in the read adapter.
- Results use DTOs or resources.
- Expensive projections state their consistency expectations.

## Model conventions

- Constructors distinguish new instances from hydration.
- Attributes are not freely mutable from outside the model.
- Behavioral methods enforce invariants before changing state.
- Events are recorded only for meaningful domain changes.
- No-op updates do not create journal noise.
- Models do not import persistence or transport types.

## Event conventions

- Names are stable and globally understandable.
- Payload schemas are versioned.
- Payloads contain durable business facts, not live ORM objects.
- Metadata contains lineage and execution context, not hidden business input.
- Queued listeners are idempotent.
- Delivery policy is explicit.

## Review checklist

Ask these questions during review:

1. Is the intent modeled as an action or query?
2. Is business behavior in the model rather than the controller or repository?
3. Is authorization visible and is data scope enforced?
4. Does persistence participate in the correct transaction?
5. Are snapshot, journal, and queued work atomic?
6. Could a remote call happen before commit?
7. Is asynchronous work idempotent and versioned?
8. Are public payloads explicit contracts/resources?
9. Can the behavior be tested with framework fakes?
10. Did feature code cross an infrastructure boundary directly?

## When to break a convention

Conventions are defaults, not substitutes for judgment. A deviation should be explicit because the
domain or operational requirement demands it, documented near the boundary, and protected by a
test. Convenience alone is not sufficient when the deviation weakens transaction, authorization,
or delivery guarantees.

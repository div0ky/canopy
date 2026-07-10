# Runtime and batteries

## Canopy module

`CanopyModule.forRootAsync()` configures the framework once per process. Composition supplies:

- Transaction manager
- Event journal and outbox
- Job dispatcher and optional schedule synchronizer
- Cache, storage, notification, and broadcasting drivers
- Logger, error reporter, and tracer
- Authentication configuration

The module exports Canopy's application-facing managers and validates framework registrations at
bootstrap.

## HTTP and WebSockets

Nest controllers and gateways remain the transport adapters. They:

- Authenticate and establish execution context
- Validate protocol contracts
- Dispatch actions and queries
- Serialize resources and envelopes
- Map known application errors to protocol-specific responses

They do not own domain workflows. Existing route and socket contracts can remain stable while an
application adopts Canopy internally.

## Authentication and authorization

Canopy supports session/JWT authentication and service identities. Authentication resolves an
actor; policies authorize abilities on subjects.

Applications with tenant, branch, or row-level scope must treat scope as a separate layer. Canopy
policies should compose with scoped read and write adapters rather than pretending a boolean
policy decision automatically filters data.

Impersonation and service-to-service actions must retain the real actor, effective actor, and
correlation metadata required for audit.

## Jobs

Jobs use shared runtime-neutral definitions and explicit worker handlers. The job contract includes
all operational behavior needed by producers and consumers:

- Stable name and version
- Zod payload parser
- Queue selection
- Attempts and backoff
- Timeout and retention
- Priority
- Deduplication

Worker handlers parse the versioned payload before executing it. Unknown versions fail visibly
rather than being interpreted as a newer shape.

## Scheduling

Schedules have stable IDs and dispatch defined jobs using a cron expression or interval. Timezone,
overlap policy, and enabled state are explicit. Startup synchronization makes deployed schedules
match code without creating duplicates.

Long-running behavior belongs in the job handler, not the scheduler method.

## Cache

The cache battery provides values, tags, locks, counters, and rate limits. Cache keys are namespaced
and versionable. A cache miss must be safe; cached data cannot become the sole record of business
state.

Use locks to coordinate cache population or idempotent work, not as a replacement for database
concurrency on domain state.

## Storage

Storage exposes named disks with local and S3-compatible implementations. Domain models record
file identity and business meaning; storage adapters handle bytes, paths, metadata, visibility,
and signed access.

Uploading or deleting remote objects normally happens after commit or in a job. Database state and
object storage cannot share a transaction, so workflows require compensating behavior and clear
retry semantics.

## Notifications

A notification describes its supported channels and channel-specific representation. Delivery may
target:

- Database notifications
- SMS
- Email
- Broadcast/realtime channels

Application code asks Canopy to send a notification; production drivers select Twilio, SendGrid,
or other providers. Queueable delivery is preferred for remote channels.

## Broadcasting

Broadcast messages declare channel, event name, and payload. Drivers may use Socket.IO, Ably,
Redis fan-out, or a composite. Resource/contract schemas should define payloads that clients can
consume independently of the chosen broadcaster.

Broadcasting is an externally visible side effect and normally occurs after commit through the
outbox.

## Observability

Logs, reports, and traces inherit execution context. Structured records should include correlation,
causation, trace, actor, action/job, and relevant domain identifiers without leaking secrets.

Expected domain failures are modeled and mapped. Unexpected failures are reported with enough
context to diagnose the execution across API, database, outbox, queue, and worker boundaries.

## Vendor boundaries

Vendor SDKs live in infrastructure adapters. A useful port expresses the capability the
application needs—`NotificationSender`, `Storage`, or a domain-specific integration—not every
method exposed by the vendor.

Adapters may preserve vendor-specific results when the business genuinely depends on them. Canopy
avoids abstractions that erase meaningful delivery states merely to make providers look uniform.

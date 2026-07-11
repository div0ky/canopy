# Generated MVP Reference Flow

- **Status:** Complete MVP acceptance proof
- **Completed:** 2026-07-10

`doxa new Garden` now creates an opinionated, domain-organized application rather than a hollow HTTP
shell. Its declaration-only Application selects infrastructure, accounts, tasks, and app Features.
The generated graph includes PostgreSQL transactions and cache, pg-boss queues and scheduling,
first-party auth, mail and SMS transports, telemetry, registration/login/verification/
recovery/bearer routes, a default-deny task policy, Eloquent-style Task model and observer, action,
route, event, local and queued listeners, signal and handler, job, and schedule.

The generator fixture starts in a new temporary directory, links only the workspace installation
that stands in for a normal package install, runs Praxis build, and asserts the generated manifest.
It then boots that exact generated registry through `@doxajs/testing`, acts as a user, calls the
protected task route, verifies entity/journal/outbox state, runs queued event, job, mail, and SMS
deliveries, and fires the declared schedule. This proves the generated application uses Doxa
contracts rather than a parallel test architecture.

The PostgreSQL reference application proves the same path through production adapters with one
identity: registration and queued verification, verification, password session, opaque constrained
bearer token, anonymous denial, protected HTTP action, resource authorization, model hydration and
save, observer phases, journal/outbox commit, local and after-commit events, immediate signal,
queued listener, idempotent job, mail/SMS delivery, schedule manual fire, and correlated telemetry,
security audit, journal, outbox, and queue records. Dedicated negative and provider-conformance
tests cover rollback, retry, terminal failure, webhooks, CSRF, replay, ambiguity, abuse controls,
shutdown, and migration drift.

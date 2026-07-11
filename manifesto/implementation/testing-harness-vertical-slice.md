# First-Party Testing Harness Vertical Slice

- **Status:** Implemented proof
- **Completed:** 2026-07-10

`@canopy/testing` boots the application's real generated manifest and registry while replacing
declared singleton providers by stable manifest ID. Overrides are validated, visible, and receive
lifecycle behavior based on the replacement instance rather than accidentally invoking hooks from
the production adapter.

`CanopyTestHarness` provides `actingAsUser`, `actingAsSystem`, anonymous execution, HTTP requests,
actions, queries, and console commands through normal runtime admission. `TestAuth` resolves HTTP
actors and captures authorization decisions. Memory implementations cover transactions, models,
journal, outbox, delivery state, queues, cache, mail, SMS, and telemetry.

The memory transaction manager copies state per transaction, commits atomically, releases
after-commit callbacks only after success, and hands `canopy.queue` outbox messages to the fake
queue only after commit. Tests prove Eloquent-style persistence, rollback, authenticated HTTP,
queued mail/SMS worker execution, durable delivery transitions, and telemetry without PostgreSQL or
provider APIs.

Remaining testing work is ergonomic event, signal, observer, schedule, revocation, and security
assertion helpers plus reusable adapter conformance suites.

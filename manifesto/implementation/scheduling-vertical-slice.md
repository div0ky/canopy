# Scheduling Vertical Slice

- **Status:** Implemented proof
- **Implemented:** 2026-07-10
- **MVP status:** Incomplete
- **Depends on:** [pg-boss queue and worker vertical slice](pg-boss-queue-worker-vertical-slice.md)

## Outcome

The eighth Canopy implementation proves that timing can remain a declaration while execution stays
inside the existing job system:

```text
Feature schedules = [ProcessCountersSchedule]
  → compiler-owned schedule manifest
  → deterministic pg-boss reconciliation
  → cron or durable interval firing
  → system actor + stable schedule causation
  → existing job worker, transaction, ModelSession, retries, and shutdown
```

Schedules do not have handlers. They answer only **when** and **which declared Job**. The Job owns
the input contract and all application behavior.

## Authoring

An interval schedule is a declaration-only class:

```ts
export class ProcessCountersSchedule extends Schedule {
  static id = 'process-counters'
  static job = ProcessCounterJob
  static everySeconds = 3_600
  static input = { key: 'scheduled-counter-sweep' }
}
```

A time-zone-aware cron schedule uses the same shape:

```ts
export class DailyHealthCheckSchedule extends Schedule {
  static id = 'daily-health-check'
  static job = ProcessCounterJob
  static cron = '0 6 * * *'
  static timeZone = 'America/Chicago'
  static input = { key: 'daily-health-check' }
}
```

The owning Feature declares `schedules = [...]`. Folder names remain organizational only.

The compiler requires:

- A stable schedule ID.
- A direct reference to a Job declared by a selected Feature.
- Exactly one of `cron` or `everySeconds`.
- A positive integer interval.
- A literal time zone and supported policies.
- A JSON-literal input, with no factories, spreads, or runtime evaluation.

That last restriction is intentional. The complete firing contract is readable without executing
application code, deterministic for deployment reconciliation, and trivial for Cultivate to
inspect and generate.

## Defaults and policies

The zero-configuration defaults are:

- `timeZone = 'UTC'`
- `overlap = 'serialize'`
- `misfire = 'skip'`

`overlap = 'serialize'` allows backlog but prevents two firings of one schedule from executing at
the same time. `overlap = 'allow'` opts into parallel execution. Separate private pg-boss queues
enforce those semantics without leaking queue policy names into application code.

The proof supports only `misfire = 'skip'`: downtime does not create an unbounded catch-up storm.
`catch-up-once` remains a required later policy and fails compilation if selected today.

## Reconciliation and distributed safety

Cron declarations are upserted by stable schedule key. A schedule moved between overlap policies
is removed from the old internal queue, and stale Canopy-owned cron records are removed. Running
the same manifest from multiple processes converges on the same pg-boss records.

Intervals are aligned to deterministic Unix-time slots. Every process may attempt to admit the
next slot, but the schedule ID and slot derive one stable UUID, so PostgreSQL admits at most one
transport record. This gives interval scheduling distributed ownership without a process-local
leader or a second coordination service. A stopped application skips elapsed slots by design.

pg-boss remains private. The manifest contains Canopy cadence, overlap, misfire, job, input, and
time-zone concepts only.

## Execution context and lifecycle

Every firing becomes a normal Canopy job attempt with:

- Actor and initiator `{ kind: 'system', id: 'canopy:scheduler' }`.
- A fresh firing/job ID and correlation ID.
- The stable schedule ID as causation.
- The declared time zone.
- The target Job's retry, backoff, and timeout policy.
- A fresh admitted execution scope, transaction, and ModelSession.

Drain cancels interval admission timers, stops both scheduler workers from claiming new work, and
waits for active firings. Normal runtime shutdown then stops pg-boss and disposes its pool.

## Executable evidence

The suite contains thirty-nine passing tests. Scheduling proof includes:

1. Cron and interval declarations introduced in manifest format v4. Authentication later advanced
   the required artifact contract to v5.
2. Cross-Feature Job targeting without path semantics.
3. Default and explicit time-zone, overlap, and misfire policy.
4. JSON-literal input inspection without application execution.
5. Deterministic interval admission across repeated runtime boots.
6. Cron reconciliation into one stable pg-boss record.
7. A real interval firing through the scheduler worker and existing Job runtime.
8. System actor and stable schedule causation observed inside the Job.
9. Existing queue, HTTP, event, model, and persistence conformance remaining green.

## Deliberate boundary

This is the first scheduling proof, not the final production scheduler. Still required:

- `catch-up-once` misfire semantics and clock-change conformance.
- Explicit enable/disable state and deployment-controlled suspension.
- Operator listing, inspection, manual fire, pause, resume, and audit commands.
- First-party schedule fakes and simulated-clock assertions.
- Crash-process and multi-process contention tests.
- Production `serve`, `work`, and `schedule` role separation.
- Metrics, traces, structured firing logs, and capacity guidance.

## Next slice

Completed next: [email and password authentication vertical slice](email-password-auth-vertical-slice.md).

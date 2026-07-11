# First-class logging

Canopy owns logging as a framework primitive. Logging is not an application-selected provider and it
is not a synonym for metrics or tracing. Every framework role automatically inherits a class-bound
`this.logger`. `Logger` remains constructor-injectable in ordinary concrete services reached through
the dependency graph.

```ts
import { Logger } from '@canopy/core'

export class SettleInvoice {
  constructor(private readonly logger: Logger) {}

  handle(invoiceId: string): void {
    this.logger.channel('billing').info('Invoice settled', { invoiceId })
  }
}
```

The API is deliberately small: `debug`, `info`, `warn`, `error`, `fatal`, `channel`, and `with`.
Applications write a message plus structured attributes. They do not assemble timestamps, actor
metadata, correlation identifiers, or terminal formatting themselves.

## One record, two presentations

Every log starts as a structured `LogRecord` containing timestamp, level, channel, message,
attributes, execution context, and an optional normalized error. A sink controls presentation:

- an interactive terminal receives concise, color-coded `[http]`, `[queue]`, `[action]`, `[db]`,
  `[auth]`, `[event]`, `[signal]`, `[schedule]`, `[lifecycle]`, and application channels;
- production and non-interactive output uses newline-delimited JSON, one record per line;
- tests use `MemoryLogSink` and make assertions against records rather than captured strings.

Official Canopy hosts enable logging and choose pretty output for a terminal or JSON for a pipe.
Embedders opt in through `Canopy.boot()` so importing the kernel never silently takes ownership of
process output. Hosts may explicitly select format, color, minimum level, destination, or a custom
sink.

## Context belongs to the framework

Logs written during admitted work automatically inherit the execution ID, correlation ID, causation
ID, actor, tenant, trace and span IDs, and transport. This applies equally to HTTP requests, jobs,
schedules, commands, events, signals, actions, and queries. Crossing an asynchronous boundary
creates a new execution while preserving causal context under the normal execution-context rules.

Framework subsystems log their own meaningful lifecycle. At minimum this includes application boot
and shutdown, admitted execution completion and failure, database transactions, action and query
handling, event and signal dispatch, queue enqueue and delivery, authentication resolution, and
authorization decisions. Application code should not recreate this framework-level noise.

## Safety invariants

- Logging failures never alter application behavior.
- Redaction happens before a record reaches any sink.
- `SecretString` and attributes whose keys identify passwords, secrets, tokens, authorization,
  cookies, or private keys are recursively replaced with `[REDACTED]`.
- Errors are normalized without mutating them, including their causal chain.
- Logging APIs never accept raw request or response bodies implicitly.
- A logger never starts background work in its constructor.

This is a concrete expression of Canopy's central product promise: opinionated, magical where it is
safe, trivial for Cultivate to understand, and extremely hard to misuse.

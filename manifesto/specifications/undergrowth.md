# Undergrowth

Undergrowth is Canopy's optional first-party development debugger. Its product contract is defined
by [decision 0025](../decisions/0025-first-party-undergrowth-debugger.md).

## Initial observation vocabulary

Each immutable observation contains:

- A unique observation ID and occurrence timestamp.
- `kind`, semantic `name`, status, duration when applicable, and stable role ID when applicable.
- Execution, source-execution, correlation, causation, trace, and span identifiers.
- Actor kind and opaque ID, tenant ID, and transport.
- Sanitized JSON attributes and a normalized sanitized error.

The initial kinds are `execution`, `http`, `action`, `query`, `transaction`, `model`, `event`,
`listener`, `signal`, `job`, `schedule`, `authorization`, `cache`, `mail`, `sms`, `log`, and
`exception`. Adding a kind is backward-compatible; changing the meaning of an existing kind is not.

## Default retention

The initial defaults retain seven days and at most 50,000 observations. Both are configurable.
Manual pruning is deterministic. Automatic pruning is best-effort and never participates in an
application transaction. The PostgreSQL recorder checks the bound after every 500 writes and
`arbor undergrowth:prune` enforces it on demand.

## UI contract

The dedicated host defaults to `127.0.0.1:4400`. It provides:

- A newest-first execution list.
- Filters for status, transport, actor, kind, and text.
- One ordered causal timeline per execution.
- Links between producer and worker executions.
- Sanitized JSON detail for each entry.
- Stable role IDs and source provenance when the application manifest provides them.

The browser UI is read-only in the initial implementation. Queue retries, token revocation, and
other mutations remain explicit Arbor operator commands.

## Developer workflow

`arbor add undergrowth` adds the package, generates the application provider, and registers it in
the Infrastructure Feature. `arbor migrate` applies the namespaced table, `arbor undergrowth` opens
the dedicated explorer, and `arbor undergrowth:prune` enforces retention. Cultivate reports whether
the observation capability is installed, the stable vocabulary, and its safety posture.

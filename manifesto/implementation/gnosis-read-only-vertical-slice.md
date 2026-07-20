# Gnosis Read-Only Local Engineering Vertical Slice

- **Status:** Implemented proof
- **Completed:** 2026-07-14
- **Specification:** [Gnosis](../specifications/gnosis.md)

Gnosis now runs as a client-owned local MCP stdio process. Praxis creates project-scoped
registration for Codex, Claude Code, Cursor, and VS Code in new applications and applies the same
registration as an upgrade recipe. Each client launches the application's installed Praxis
`doxa mcp` entrypoint on demand; developers do not start a daemon or standing process. The installer
updates only the Gnosis entry and preserves unrelated agent configuration. It also creates or
updates one marked Doxa guidance block in the root `AGENTS.md`, preserving guidance outside that
block and failing closed on malformed or duplicate markers. Registration is discovered when a client
opens the workspace or starts a task; Praxis output and the managed guidance now state that creation
or upgrade inside an existing task requires a client reload or reopen and a new task before Gnosis
tools can appear. Codex passes a configured relative MCP working directory directly to its process
launcher instead of anchoring it to the task workspace, so Praxis emits an absolute application
`cwd` for both root and nested applications.

Praxis compiles the application through the ordinary development build path and passes the resulting
manifest directly to Gnosis; the server never scans source, boots the application, or trusts a
separately discovered artifact.

`@doxajs/introspection` validates the manifest and build hash, derives typed deterministic graph and
role records, bounds lists, redacts credential-shaped values, and owns the generated Gnosis
knowledge contract. Praxis JSON and MCP tools use the same functions.

This historical slice added declared model relationships, related and pivot model IDs, and logical
key metadata to the then-current manifest format. The compiler resolves relationship helper
declarations against models selected by Features and fails closed when a relationship points outside
the application graph.

`@doxajs/gnosis` uses the pinned official TypeScript MCP SDK. It exposes application information,
graph, routes, models, actions, queries, events, listeners, observers, jobs, schedules, policies,
permission sources, commands, and deterministic version-matched documentation search. All tools are
read-only, idempotent, bounded, and closed-world. Unknown models return stable structured errors.

The sole application-data capability is `query_models`. It accepts a stable model ID, explicitly
selected logical fields, bounded comparison filters and ordering, and at most 100 rows. Praxis boots
the matching artifact with the restricted `model-reader` profile in a fresh authenticated
non-production console execution. The profile starts only the transaction-provider dependency
closure, uses Doxa's read-only `ModelSession` without application model observers, disables
application logging and diagnostic adapters, and always shuts the runtime down. The tool refuses
production, raw SQL, physical table and column names, arbitrary expressions, and mutations.

The package is an optional Praxis dependency and is absent from production installations performed
with `--prod --no-optional`. Remote transport, unrestricted application-data access, logs, tests,
arbitrary execution, and mutations remain outside this slice.

Executable evidence lives in `tests/gnosis.test.ts`, including a real MCP client launched from
generated registration, and in the Praxis generated-application and upgrade acceptance tests,
package audits, boundary audits, documentation audits, and the repository verification gate.

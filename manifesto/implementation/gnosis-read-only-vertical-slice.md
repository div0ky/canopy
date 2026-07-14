# Gnosis Read-Only Local Engineering Vertical Slice

- **Status:** Implemented proof
- **Completed:** 2026-07-13
- **Specification:** [Gnosis](../specifications/gnosis.md)

Gnosis now runs as a client-owned local MCP stdio process. Praxis creates project-scoped
registration for Codex, Claude Code, Cursor, and VS Code in new applications and applies the same
registration as an upgrade recipe. Each client launches the application's installed Praxis
`doxa mcp` entrypoint on demand; developers do not start a daemon or standing process. The installer
updates only the Gnosis entry and preserves unrelated agent configuration.

Praxis compiles the application through the ordinary development build path and passes the resulting
manifest directly to Gnosis; the server never scans source, boots the application, or trusts a
separately discovered artifact.

`@doxajs/introspection` validates the manifest and build hash, derives typed deterministic graph and
role records, bounds lists, redacts credential-shaped values, and owns the generated Gnosis
knowledge contract. Praxis JSON and MCP tools use the same functions.

Manifest format 3 adds declared model relationships, related and pivot model IDs, and logical key
metadata. The compiler resolves relationship helper declarations against models selected by Features
and fails closed when a relationship points outside the application graph.

`@doxajs/gnosis` uses the pinned official TypeScript MCP SDK. It exposes application information,
graph, routes, models, actions, queries, events, listeners, observers, jobs, schedules, policies,
commands, and deterministic version-matched documentation search. All tools are read-only,
idempotent, bounded, and closed-world. Unknown models return stable structured errors.

The package is an optional Praxis dependency and is absent from production installations performed
with `--prod --no-optional`. Remote transport, application data, logs, tests, arbitrary execution,
and mutations remain outside this slice.

Executable evidence lives in `tests/gnosis.test.ts`, including a real MCP client launched from
generated registration, and in the Praxis generated-application and upgrade acceptance tests,
package audits, boundary audits, documentation audits, and the repository verification gate.

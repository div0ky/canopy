# Gnosis: AI-Assisted Engineering

- **Viability:** High
- **Direction:** Accepted
- **Product:** Gnosis
- **Package:** `@doxajs/gnosis`
- **Implementation:** Deferred until the manifest and diagnostics stabilize
- **Decision:** [0013: Gnosis](../decisions/0013-first-party-ai-engineering-mcp.md)

Gnosis will provide Doxa's Laravel Boost-like developer experience: a local MCP server,
version-aware documentation, framework guidelines, focused agent skills, application inspection, and
carefully controlled engineering workflows.

## Product shape

Gnosis's MCP transport is launched through the framework CLI:

```text
doxa mcp
```

The initial server runs locally over stdio and gives compatible coding agents read-only access to
the actual Doxa application model: packages and versions, features, dependency graph, routes,
models, schemas, actions, queries, policies, events, observers, listeners, jobs, schedules,
migrations, diagnostics, errors, logs, tests, and version-matched documentation.

Doxa will also generate agent guidelines and install on-demand skills based on the framework and
first-party plugins present in the application.

## Architectural advantage

The MCP server does not need to discover Doxa from scratch. The same generated manifest powers boot
validation, the dependency container, runtime adapters, CLI inspection, generators, diagnostics,
testing, and future AI tooling.

That creates one chain of truth:

```text
TypeScript application
  -> Doxa compiler
  -> versioned application manifest
  -> introspection and diagnostics API
  -> CLI, tests, documentation tools, and MCP
```

If MCP requires a separate scanner, runtime boot, or application interpretation, the design has
drifted.

## What we preserve now

Before implementing the MCP server, Doxa will ensure its foundational contracts provide:

- Stable capability identifiers and descriptions.
- Source provenance and file locations.
- Machine-readable schemas and diagnostics.
- Structured JSON output for CLI inspection.
- Package and framework version information.
- Operation planning and dry-run diffs for future mutating tools.
- Secret, sensitive, high-cardinality, and mutability classifications.
- Version-addressable framework and plugin documentation.

These requirements improve Doxa's ordinary human tooling and keep the later MCP adapter small.

## Deferred implementation phases

### Phase 1: Read-only local server

- Application and package information.
- Documentation search.
- Manifest and dependency-graph inspection.
- Routes, models, actions, queries, events, observers, listeners, jobs, and schedules.
- Database schema and migration status.
- Bounded logs, recent errors, command discovery, and test execution.

### Phase 2: Guidelines and skills

- Versioned Doxa engineering guidelines.
- Installed-plugin guidelines.
- Focused skills for common development workflows.
- Agent-specific configuration generation.

### Phase 3: Reviewable mutations

- Generator and codemod previews.
- User-approved application of CLI operation plans.
- Migration planning without automatic production application.
- Explicitly privileged operational tools where justified.

Remote application MCP endpoints and arbitrary evaluation are separate product decisions and are not
implied by this developer-tool direction.

## Success criteria

The capability succeeds when an AI coding agent can understand the exact Doxa version and real
application graph, find version-correct guidance, inspect framework behavior, run targeted tests,
and propose idiomatic changes without guessing private engine APIs or bypassing Doxa's safety model.

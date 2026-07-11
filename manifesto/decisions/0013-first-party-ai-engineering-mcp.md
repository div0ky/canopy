# 0013: Build Cultivate as Canopy's First-Party AI Engineering Product

- **Status:** Accepted
- **Accepted:** 2026-07-10
- **Product name:** Cultivate
- **Package:** `@canopy/cultivate`
- **Implementation:** Deferred until application-manifest and diagnostics contracts stabilize
- **Target:** After application-manifest and diagnostics contracts stabilize
- **Decision owners:** Canopy maintainers

## Decision

Canopy will provide a first-party AI-assisted engineering product named **Cultivate**, built around
a local MCP server, version-aware documentation, generated guidelines, focused skills, application
inspection, and safe engineering workflows. Canopy will design its manifest, diagnostics,
documentation, CLI, and package metadata to power Cultivate. Implementation is deferred until those
source contracts are stable enough that the MCP surface will not become a second, incompatible
interpretation of the application.

Cultivate includes more than an MCP transport. It combines:

- A Canopy-aware local MCP server.
- Version-aware framework and plugin documentation.
- Generated agent guidelines.
- On-demand agent skills.
- Structured application inspection.
- Safe, reviewable access to selected CLI and testing workflows.

## Why it is viable

Canopy already intends to compile one application manifest containing features, providers, routes,
models, actions, queries, policies, observers, listeners, jobs, schedules, schemas, scopes, and
source provenance. The CLI and diagnostics consume the same representation.

The MCP server can therefore adapt a stable Canopy introspection API rather than reconstructing the
application through runtime reflection. This makes the protocol layer comparatively small and keeps
agent behavior consistent with boot validation, generators, tests, and human-facing diagnostics.

## Why implementation is deferred

An MCP server built before the manifest and diagnostics stabilize would freeze accidental shapes,
duplicate inspection logic, and require repeated compatibility migrations. Canopy should preserve
machine-readable foundations now and implement the agent product after:

- The application manifest has a versioned schema.
- Source locations and declaration provenance are reliable.
- `canopy inspect:*` commands expose stable structured results.
- CLI mutations can produce plans and diffs before applying changes.
- Framework and plugin documentation is versioned and package-addressable.
- Configuration and diagnostics classify secret and sensitive values.

## Boundary

The MCP server is a developer tool and local adapter over Canopy capabilities. It does not become
the source of truth for application discovery, schema, diagnostics, generation, or documentation.

```text
application manifest ─┐
diagnostics API       ├─> Canopy introspection API ─> CLI
documentation index  ┤                              └─> MCP server
operation planner    ┘
```

Every MCP capability should have a corresponding Canopy contract usable without MCP. Agent clients
must not receive privileged framework APIs unavailable to tests, diagnostics, or the CLI without an
explicit security reason.

## Initial transport

Cultivate's first server should be local-only and use MCP's stdio transport:

```text
canopy mcp
```

The AI client launches the command inside the application workspace. A remote Streamable HTTP
transport is deferred because it introduces authentication, tenancy, origin validation, network
exposure, and production-data concerns unrelated to the initial developer experience.

Canopy should use the official TypeScript MCP SDK behind a small protocol adapter and pin its
version through the Canopy compatibility contract.

## Read-only first surface

The initial MCP server should be read-only by default.

Recommended resources include:

```text
canopy://application/manifest
canopy://application/graph
canopy://routes
canopy://models/{model}
canopy://events
canopy://jobs
canopy://schedules
canopy://database/schema
canopy://docs/{package}/{version}
```

Recommended tools include:

```text
application_info
search_docs
inspect_graph
list_routes
describe_model
list_actions
list_queries
list_events
list_listeners
list_observers
list_jobs
list_schedules
migration_status
last_error
read_logs
list_commands
list_tests
run_tests
```

Tool names are illustrative. The specification must keep the surface focused so tool discovery does
not create context bloat.

## Mutating tools

Code generation, migrations, database access, job redrive, and arbitrary application evaluation are
not part of the initial read-only surface.

When mutating tools are introduced, they must:

- Reuse Canopy's CLI operation planner.
- Return a dry-run plan or diff before applying.
- Require explicit user approval through the client where supported.
- Stay inside the declared workspace root.
- Refuse to overwrite user code silently.
- Respect dirty-worktree and conflict policies.
- Emit a structured audit record of the requested and completed operation.

An unrestricted Tinker-like evaluator or arbitrary SQL tool should not be exposed by default. If
either is ever supported, it requires a distinct high-risk capability, strict local-only policy,
limits, redaction, and explicit opt-in.

## Guidelines and skills

Canopy releases should ship versioned agent guidelines describing durable framework conventions.
Focused skills should be installable on demand for areas such as models, actions, testing, jobs,
authentication, and plugin development.

First-party plugins may contribute versioned documentation, guidelines, and skills through signed or
package-verifiable metadata. They may not inject executable MCP tools merely by being installed;
tool contribution requires a separate trusted extension contract.

The Canopy CLI should generate agent-specific configuration without making any one editor or coding
agent part of the framework contract.

## Documentation search

The first implementation may use a local, version-filtered documentation index. Semantic search or a
hosted embeddings service is an enhancement, not a prerequisite for the MCP server.

Search results must identify the package, exact supported version, source document, and relevant
section so agents do not combine incompatible framework releases.

## Security model

The developer MCP server must:

- Run as a development-only dependency and remain absent from production startup.
- Use stdio and the current workspace by default.
- Expose configuration keys and classifications without revealing secret values.
- Redact credentials, session tokens, password hashes, personal data, and provider secrets from logs
  and diagnostics.
- Treat database schemas as readable metadata but database contents as a separate privileged
  capability.
- Keep read operations bounded by size, time, and result count.
- Validate all tool inputs through Canopy's Standard Schema boundary.
- Return stable structured errors rather than raw internal exceptions.
- Record framework, manifest, protocol, and package versions in `application_info`.

## Manifest requirements created now

To keep this future capability easy, today's manifest and tooling contracts should include:

- Stable IDs for every feature and declared capability.
- Human-readable descriptions.
- Exact source file and declaration locations.
- Input and output schemas where applicable.
- Provider, scope, lifecycle, and dependency relationships.
- Route, policy, observer, listener, job, and schedule relationships.
- Framework and plugin package provenance and versions.
- Sensitivity and mutability classifications for inspectable values and operations.
- Machine-readable diagnostic codes and suggested remediation.

These fields benefit human tooling and testing even if the MCP server is never enabled.

## Effort assessment

A minimal read-only stdio MCP server should be straightforward once the introspection API exists.
The larger effort is a Boost-quality product: high-quality versioned documentation search, useful
guidelines and skills, safe mutation planning, agent installers, security review, and compatibility
testing across clients.

Canopy should treat that larger product as post-MVP developer experience work, not as a reason to
pollute or delay the core runtime.

## Required proof before activation

1. MCP and CLI inspection return the same application facts.
2. Tool schemas derive from stable Canopy contracts.
3. No secret values or private provider types cross the server boundary.
4. Read-only tools remain bounded and deterministic.
5. Agent configuration works with multiple MCP-capable clients.
6. Documentation search returns version-correct sources.
7. Mutating previews, when later enabled, exactly match the changes applied by the CLI.
8. Protocol upgrades remain isolated inside the MCP adapter.

## References

- [Cultivate AI-assisted engineering direction](../future/ai-assisted-engineering.md)
- [Canopy CLI and generator decision](0004-first-party-cli-generators.md)
- [Canopy OOP and manifest decision](0011-class-first-oop-container.md)
- [Laravel Boost](https://laravel.com/docs/12.x/boost)
- [Model Context Protocol server concepts](https://modelcontextprotocol.io/docs/learn/server-concepts)
- [Official MCP SDKs](https://modelcontextprotocol.io/docs/sdk)

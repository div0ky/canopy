# Gnosis Read-Only Local Engineering Server

- **Status:** Accepted
- **Accepted:** 2026-07-13
- **Decision:**
  [0013: first-party AI engineering MCP](../decisions/0013-first-party-ai-engineering-mcp.md)

## Purpose and boundary

Gnosis is Doxa's local AI engineering server. Phase 1 exposes the compiled application graph and
version-matched Doxa guidance through MCP over stdio. It is a development tool, never a production
runtime role, and never a source of truth for application discovery.

Gnosis does not scan source, boot the application, query application data, run arbitrary code, or
mutate the workspace. Remote transport, test execution, logs, database contents, generators,
migrations, redrive, and operation application are explicitly deferred.

## One chain of truth

```text
TypeScript application
  -> Doxa compiler
  -> validated versioned manifest
  -> @doxajs/introspection
  -> Praxis text or JSON
  -> @doxajs/gnosis MCP adapter
```

`@doxajs/introspection` owns typed inspection records and deterministic views. Praxis and Gnosis
must consume those records rather than independently interpreting manifest entries. MCP protocol
types may not leak into the introspection package or manifest.

## Launch and lifecycle

Developers do not manually start Gnosis. Praxis registers Gnosis in supported project-scoped agent
configuration when it creates or upgrades an application. The selected MCP client launches the
registered `doxa mcp` entrypoint on demand inside the application workspace, owns the child-process
lifetime, and stops it with the client session. A client may still require its normal first-use
workspace trust confirmation.

`doxa mcp` is an integration and diagnostic entrypoint, not the ordinary developer workflow. It
compiles the development application through the ordinary Praxis build path before starting Gnosis.
A failed compilation prevents the server from starting. The server then receives the in-memory
manifest returned by that build; it does not trust an independently discovered or stale artifact.

The server uses the official pinned TypeScript MCP SDK and stdio transport. It writes no protocol
information to stdout outside the MCP transport. Shutdown closes the transport without booting or
draining a Doxa application runtime.

## Initial resources and tools

Phase 1 provides these resources:

- `doxa://application/manifest`
- `doxa://application/graph`
- `doxa://application/routes`
- `doxa://application/models`
- `doxa://documentation/index`

Phase 1 provides these read-only tools:

- `application_info`
- `inspect_graph`
- `list_routes`
- `describe_model`
- `list_actions`
- `list_queries`
- `list_events`
- `list_listeners`
- `list_observers`
- `list_jobs`
- `list_schedules`
- `list_policies`
- `list_commands`
- `search_docs`

All results use stable ordering. List and search results are bounded to 100 records. Documentation
queries are bounded to 200 characters and results to 20 sections. Unknown model IDs return MCP error
results with stable JSON error bodies; malformed arguments fail through MCP schema validation rather
than reaching tool handlers or raw internal exceptions. Error results do not include
`structuredContent`, because MCP output schemas describe successful tool output.

## Application information

`application_info` reports the application ID, Doxa framework version, compiler version, manifest
format version, manifest build hash, Gnosis package version, MCP protocol adapter version, and
declared plugin package names. It never reports environment values.

## Model inspection

Model inspection exposes the stable model ID, owning Feature, logical attributes, declared storage
ownership, source provenance, and declared relationships. Relationship records identify kind,
related model, optional pivot model, and logical key names. They never expose database contents.

## Documentation

Gnosis ships a local documentation index with the exact Gnosis release. Each searchable section
records the owning package, exact framework version, source document, heading, and text. Search is
deterministic and lexical in Phase 1; embeddings and hosted services are unnecessary.

Search results may only come from the installed Gnosis documentation bundle and must report the
exact version. Plugins may contribute documentation only through a later package-verifiable metadata
contract.

## Security

- The MCP server is an optional development dependency and is absent from `--prod --no-optional`
  installations.
- Transport is stdio only.
- No tool accepts a filesystem path, command, SQL, URL, or arbitrary expression.
- Manifest configuration records expose keys, kinds, optionality, and sensitivity, never resolved
  values.
- Returned text and structured content pass through recursive credential redaction.
- Read operations are bounded by fixed result and text limits.
- Tool inputs are validated by the MCP SDK through Zod's Standard Schema implementation.
- Errors have stable codes and safe messages.

## Compatibility

The introspection schema and Gnosis knowledge schema are independently versioned. A Gnosis release
declares the manifest format it accepts. Unsupported formats fail closed before tool registration.
Protocol changes remain isolated inside `@doxajs/gnosis`.

## Required conformance

1. Praxis JSON and MCP return the same typed application facts.
2. Manifest and graph resources are deterministic for the same build hash.
3. A stale or unsupported manifest is rejected before the server connects.
4. Configuration secrets and credential-shaped nested values are recursively redacted.
5. Every list and documentation result respects its fixed bound.
6. Model inspection includes declared relationships and rejects unknown model IDs.
7. Documentation search returns the exact installed Doxa version and source section.
8. The server works through an in-memory MCP client and the real stdio `doxa mcp` launch path.
9. Production dependency closure does not contain Gnosis, the MCP SDK, the compiler, or TypeScript.
10. A newly generated application contains valid project-scoped registration for Codex, Claude Code,
    Cursor, and VS Code; each registration launches the application-installed Praxis version.
11. Registration updates preserve unrelated agent configuration and existing applications receive
    the same registration through the Doxa upgrade path.

# Development Hot Reload Vertical Slice

- **Status:** Implemented proof
- **Completed:** 2026-07-11

`arbor dev` and the Canopy framework workspace now watch application source and replace the running
development runtime after a successful edit. Developers do not manually restart the server when a
route, Feature declaration, service, event, job, policy, or other application class changes.

The implementation preserves Canopy's immutable-graph rule. It does not patch a container, Hono
router, or Node module in place. The supervisor compiles TypeScript, regenerates the canonical
manifest and constructor registry, gracefully stops the previous child, and boots a fresh process
with a completely new ESM module graph. This makes role additions and dependency-graph changes as
reliable as ordinary handler edits.

Builds occur while the last good child remains available. A syntax, type, compiler, or manifest
error is printed on the `[hmr]` channel and does not stop that child. Once the source is valid
again, the next filesystem change performs the replacement. Recursive filesystem events are
debounced and source-fingerprinted so delayed or duplicate platform notifications cannot cause
reload loops.

The executable proof covers:

- filesystem-driven reload without an explicit restart call;
- coalescing repeated change notifications into one replacement;
- retaining the last good target after a failed build;
- recovering on the next valid edit;
- graceful runtime and HTTP-host shutdown before child replacement;
- fresh-process loading, which avoids unsafe attempts to invalidate Node's ESM cache;
- live `/pong` response changes and recovery under one persistent `pnpm dev` supervisor.

Production `serve`, `work`, and `schedule` commands remain immutable single-runtime hosts and never
watch source files.

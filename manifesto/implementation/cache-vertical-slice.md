# Cache Vertical Slice

- **Status:** Implemented proof
- **Completed:** 2026-07-10

Canopy owns an injectable `Cache` port with `get`, `put`, atomic `add`, atomic `increment`, `forget`,
and `remember` semantics. Values use Canopy's JSON contract, and TTL is expressed in seconds.

`MemoryCache` provides a deterministic local/test implementation with an injectable clock.
`PostgresCache` provides the production-shaped proof, owns its connection lifecycle, stores values
in `canopy_cache_entries`, replaces expired entries atomically, preserves TTL across increments,
and is selected through the generated provider graph. Feature code imports only `Cache`.

The cache schema is an explicit migration; runtime boot never creates it. Remaining MVP work is
Arbor migration/pruning commands, namespace/tag policy, metrics, and a shared adapter conformance
suite.

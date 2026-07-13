---
'@doxajs/auth-postgres': patch
'@doxajs/compiler': patch
'@doxajs/core': patch
'@doxajs/http-hono': patch
'@doxajs/manifest': patch
'@doxajs/praxis': patch
'@doxajs/postgres-drizzle': patch
'@doxajs/queue-pg-boss': patch
'@doxajs/runtime': patch
'@doxajs/testing': patch
---

Protect cookie-authenticated WebSocket upgrades, keep observation and HTTP error handling fail-safe,
complete Event and Signal role injection through the re-baselined manifest format 1, and add
bounded, transactionally claimed `catch-up-once` schedule misfires.

This prerelease condenses Doxa-owned schemas into foundational migrations. Existing alpha
applications must rebuild artifacts and recreate their prerelease databases instead of applying
these rewritten migration checksums in place.

---
'@doxajs/compiler': patch
'@doxajs/core': patch
'@doxajs/manifest': patch
'@doxajs/praxis': patch
---

Move mandatory HTTP, PostgreSQL, pg-boss, authentication, account routes, and health into a
framework-owned core Feature. Scaffold applications around `app.config.ts`, user Features, and
optional plugin package declarations without editable infrastructure or authentication source.

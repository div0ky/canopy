---
'@doxajs/compiler': patch
'@doxajs/core': patch
'@doxajs/gnosis': patch
'@doxajs/manifest': patch
'@doxajs/postgres-drizzle': patch
'@doxajs/praxis': patch
'@doxajs/runtime': patch
'@doxajs/testing': patch
---

Harden mapped models around the compiler-declared contract. Reads now use explicit projections,
hydration and attribute access reject undeclared fields, updates write declared dirty patches, and
mapped models expose independent `managed` and `readOnly` settings. PostgreSQL readiness validates
only the declared relation contract, and manifest format 6 requires rebuilding application
artifacts.

This is an intentional alpha-breaking correction: permissive mapped-model `SELECT *` hydration and
the public arbitrary-string `getAttribute` overload are removed without a compatibility opt-out.

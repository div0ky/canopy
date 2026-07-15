---
'@doxajs/auth-postgres': patch
'@doxajs/compiler': patch
'@doxajs/core': patch
'@doxajs/gnosis': patch
'@doxajs/introspection': patch
'@doxajs/manifest': patch
'@doxajs/praxis': patch
'@doxajs/postgres-drizzle': patch
'@doxajs/runtime': patch
'@doxajs/testing': patch
---

Add artifact-only, config-driven authentication for existing PostgreSQL identity Models and raw
login-only tables. Canonicalize the public API around identifiers, add reviewed legacy credential
readers and Doxa-owned upgrade sidecars, enforce eligibility and mapped readiness, derive auth
migrations from compiled capabilities, and expose safe mapping details through Praxis and Gnosis.

This is an intentional alpha-breaking contract. Applications now import `PostgresAuth` only from
`@doxajs/auth-postgres/framework`; ordinary application code imports `Auth` from `@doxajs/core`. The
removed `email` login and registration alias must be renamed to `identifier`.

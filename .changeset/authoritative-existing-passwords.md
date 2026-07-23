---
'@doxajs/auth-postgres': patch
'@doxajs/compiler': patch
'@doxajs/core': patch
'@doxajs/gnosis': patch
'@doxajs/introspection': patch
'@doxajs/manifest': patch
'@doxajs/praxis': patch
---

Replace mapped password write destinations and password sidecars with one authoritative external
credential column and an explicit `never` or compare-and-swap in-place Argon2id upgrade policy.
Define login-only as verification and session/token issuance without identity or credential
mutation, accept explicitly configured SHA-256 for login and reauthentication, preserve verification
sidecars, and add a fail-closed forward migration for retiring populated alpha password sidecars.

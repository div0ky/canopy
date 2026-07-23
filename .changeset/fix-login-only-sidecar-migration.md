---
'@doxajs/auth-postgres': patch
---

Allow login-only mapped identities to migrate a valid legacy SHA-256 password into the Doxa-owned
Argon2id sidecar before atomically issuing the session. Externally owned and non-sidecar weak
credentials remain rejected.

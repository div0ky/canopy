---
'@doxajs/auth-postgres': patch
'@doxajs/core': patch
'@doxajs/http-hono': patch
'@doxajs/praxis': patch
'@doxajs/queue-pg-boss': patch
'@doxajs/runtime': patch
'@doxajs/testing': patch
'@doxajs/theoria': patch
---

Harden framework security boundaries with byte-limited HTTP admission, versioned and validated queue
execution contexts, bounded bearer constraints, safe weak-hash reauthentication behavior, and
non-disclosing Theoria errors. Record the remaining credential-at-rest and asynchronous authority
findings as release blockers.

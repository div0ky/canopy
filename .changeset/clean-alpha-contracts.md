---
'@doxajs/auth-postgres': patch
'@doxajs/compiler': patch
'@doxajs/core': patch
'@doxajs/gnosis': patch
'@doxajs/http-hono': patch
'@doxajs/introspection': patch
'@doxajs/keryx': patch
'@doxajs/manifest': patch
'@doxajs/opentelemetry': patch
'@doxajs/postgres-drizzle': patch
'@doxajs/praxis': patch
'@doxajs/queue-pg-boss': patch
'@doxajs/realtime': patch
'@doxajs/runtime': patch
'@doxajs/sendgrid': patch
'@doxajs/testing': patch
'@doxajs/theoria': patch
'@doxajs/twilio-sms': patch
---

Remove the deprecated alpha-only Theoria `retentionDays` alias in favor of `hotRetentionDays`, align
the documented existing-table authentication implementation status, enforce the Node.js runtime
floor required by first-party Argon2id authentication, add PostgreSQL 16 conformance coverage, and
document Doxa's closed controlled-adoption program across every published package.

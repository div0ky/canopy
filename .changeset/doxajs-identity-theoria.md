---
'@doxajs/praxis': patch
'@doxajs/auth-postgres': patch
'@doxajs/compiler': patch
'@doxajs/core': patch
'@doxajs/http-hono': patch
'@doxajs/manifest': patch
'@doxajs/postgres-drizzle': patch
'@doxajs/queue-pg-boss': patch
'@doxajs/runtime': patch
'@doxajs/sendgrid': patch
'@doxajs/testing': patch
'@doxajs/twilio-sms': patch
'@doxajs/theoria': patch
---

Adopt the Doxa.js framework identity and `@doxajs` package scope across the complete public surface.

Correct Theoria's activity projections so All and Events expose literal event observations,
scheduled work remains a queue job, and schedule observations remain independently filterable.

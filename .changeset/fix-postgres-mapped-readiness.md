---
'@doxajs/postgres-drizzle': patch
---

Fix mapped-model PostgreSQL readiness for quoted mixed-case and schema-qualified relations. Logical
string attributes now accept date and timestamp columns consistently with ISO-string hydration, and
read-only views without version columns retain their non-concurrency version source.

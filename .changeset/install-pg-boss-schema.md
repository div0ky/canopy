---
'@doxajs/praxis': patch
'@doxajs/queue-pg-boss': patch
---

Install and migrate the pinned pg-boss engine schema during explicit Doxa migrations and before
development boot, so a newly generated PostgreSQL database can start workers and schedules.

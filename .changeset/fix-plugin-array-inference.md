---
'@doxajs/compiler': patch
'@doxajs/praxis': patch
---

Preserve literal plugin package types when scaffolding applications and when `doxa add` updates an
existing `app.config.ts`, so optional plugin installation remains TypeScript-safe.

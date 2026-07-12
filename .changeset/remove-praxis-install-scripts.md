---
'@doxajs/praxis': patch
---

Keep Drizzle Studio out of the Praxis installation closure so `pnpm dlx` scaffolding does not ask
users to approve esbuild. Praxis now acquires its pinned Drizzle Studio tool only when requested.

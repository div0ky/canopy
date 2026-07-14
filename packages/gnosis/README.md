# `@doxajs/gnosis`

Gnosis is Doxa's local, read-only AI engineering server. Praxis registers it in project-scoped MCP
configuration when an application is created or upgraded. Open the application in Codex, Claude
Code, Cursor, or VS Code and the client starts and stops Gnosis automatically.

The registered command uses the application's installed Praxis package. Praxis compiles the current
application before connecting Gnosis over MCP stdio. Gnosis exposes bounded structured inspection
and version-matched local documentation from the compiled artifact. Its `query_models` tool may boot
that exact artifact in a fresh non-production, read-only console execution to retrieve explicitly
selected logical model fields; it does not accept SQL or expose mutation. Praxis also installs a
managed Doxa guidance block in the application's root `AGENTS.md`. Clients may require their normal
first-use project trust confirmation.

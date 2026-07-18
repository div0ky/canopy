# `@doxajs/praxis`

> **Controlled-adoption prerelease:** Publicly downloadable under Apache-2.0; Midtown Home
> Improvements is the sole supported consumer. External use is permitted without compatibility,
> support, warranty, roadmap, or production-readiness commitments.

Praxis is Doxa's canonical generator and command suite. It owns application generation, compilation,
development hot reload, migrations, runtime roles, inspection, recovery, Drizzle Studio, Gnosis
knowledge, and Theoria operations.

```sh
pnpm dlx @doxajs/praxis new MyApplication
cd my-application
pnpm install
pnpm dev
```

Run `doxa --help` for the complete command surface.

Use `doxa permission-source:list` (or `--json`) to inspect the selected application permission
source and its declared abilities without evaluating runtime permission records.

Generate the source with
`doxa make:permission-source Feature/ApplicationPermissions --abilities=contact.read,contact.update`.
Use `doxa make:service Feature/ApplicationAccess --provide` when its ordinary service adapter must
cross a Feature boundary.

Praxis registers the local read-only Gnosis MCP server with Codex, Claude Code, Cursor, and VS Code
when it creates or upgrades an application and maintains a Doxa guidance block in the root
`AGENTS.md`. Open the repository in a supported client; the client starts and stops Gnosis on demand
in the application workspace, including when the application is nested in a monorepo. Along with
compiled application inspection and documentation, Gnosis can perform bounded non-production model
reads through Doxa's read-only persistence path. Some clients ask you to trust a project MCP server
the first time they use it.

Regenerate one or more project registrations after removing or customizing them:

```sh
pnpm doxa gnosis:install --agent=codex,claude
```

`doxa mcp` is the underlying stdio entrypoint for clients and protocol diagnostics, not a process
developers normally start themselves.

Upgrade an existing application with a reviewable plan and post-install validation:

```sh
pnpm doxa upgrade --dry-run
pnpm doxa upgrade --verify
```

For applications whose installed Praxis predates `doxa upgrade`, bootstrap once with
`pnpm dlx @doxajs/praxis@alpha upgrade`.

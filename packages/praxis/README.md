# `@doxajs/praxis`

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

Praxis registers the local read-only Gnosis MCP server with Codex, Claude Code, Cursor, and VS Code
when it creates or upgrades an application. Open the installed application in a supported client;
the client starts and stops Gnosis on demand. Some clients ask you to trust a project MCP server the
first time they use it.

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

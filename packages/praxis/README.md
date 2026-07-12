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

Upgrade an existing application with a reviewable plan and post-install validation:

```sh
pnpm doxa upgrade --dry-run
pnpm doxa upgrade --verify
```

For applications whose installed Praxis predates `doxa upgrade`, bootstrap once with
`pnpm dlx @doxajs/praxis@alpha upgrade`.

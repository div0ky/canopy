# Getting Started

Create a production-shaped Doxa application in a few minutes.

## Requirements

- Node.js 24
- pnpm 11 through Corepack
- Docker for the generated local PostgreSQL service

## Create and run

```sh
pnpm dlx @doxajs/praxis new MyApplication
cd my-application
pnpm install
cp .env.example .env
docker compose up -d
pnpm migrate
pnpm dev
```

Open `http://127.0.0.1:3000/` for the generated application. Doxa owns the mandatory public
`GET /health` operational endpoint. `pnpm dev` watches `app.config.ts` and source, preserves the
last valid runtime when compilation fails, and replaces it with a fresh process after a valid build.

## Generated structure

```text
app.config.ts
src/
  app/
  features/
migrations/
Dockerfile
compose.yaml
compose.production.yaml
```

`app.config.ts` selects user Features and optional plugins. The editable `AppFeature` owns the
default root route and any other application-level routes. Mandatory HTTP, PostgreSQL, pg-boss,
cache, auth, and health declarations are generated under gitignored `.doxa/` and remain visible in
the compiled manifest rather than user source. Folder names are organizational only.

## Useful commands

```sh
pnpm doxa route:list
pnpm doxa model:list
pnpm doxa graph
pnpm doxa db:studio
pnpm doxa add sendgrid
pnpm doxa add twilio-sms
pnpm doxa add theoria
pnpm test
```

Run `pnpm doxa --help` for generators, inspection, recovery, authentication, queue, schedule, cache,
migration, Gnosis, and runtime commands.

## Gnosis and coding agents

Generated applications include project-scoped Gnosis registration for Codex, Claude Code, Cursor,
and VS Code plus a managed Doxa guidance block in the root `AGENTS.md`. After `pnpm install`, open
the application in a supported client. The client launches Gnosis over stdio when it needs Doxa
inspection, documentation, or a bounded non-production model read and stops it with the client
session; there is no Gnosis daemon to start. Model reads use stable model IDs and logical
attributes, never raw SQL, and run through a fresh read-only execution. A client may ask you to
trust the project MCP server on first use.

Run `pnpm doxa gnosis:install --agent=all` only to regenerate deleted or customized registration.
`doxa mcp` is the client entrypoint and protocol-debugging command, not an ordinary startup step.

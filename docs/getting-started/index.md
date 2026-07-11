# Getting Started

## Requirements

- Node.js 24
- pnpm 11 through Corepack
- Docker for the generated local PostgreSQL service

## Create and run

```sh
pnpm dlx @canopy/arbor@next new MyApplication
cd my-application
pnpm install
cp .env.example .env
docker compose up -d
pnpm migrate
pnpm dev
```

Open `http://127.0.0.1:3000/` for the generated application and `/health` for its health route.
`pnpm dev` watches source, preserves the last valid runtime when compilation fails, and replaces it
with a fresh process after a valid build.

## Generated structure

```text
src/
  application.ts
  app/
  accounts/
  tasks/
  infrastructure/
migrations/
Dockerfile
compose.yaml
compose.production.yaml
```

Folder names are organizational only. The Application chooses Features, each Feature explicitly
declares framework-facing classes, and the compiler derives every reachable dependency.

## Useful commands

```sh
pnpm arbor route:list
pnpm arbor model:list
pnpm arbor graph
pnpm arbor db:studio
pnpm arbor add undergrowth
pnpm test
```

Run `pnpm arbor --help` for generators, inspection, recovery, authentication, queue, schedule,
cache, migration, Cultivate, and runtime commands.

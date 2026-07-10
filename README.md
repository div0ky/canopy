# Canopy

Canopy is an opinionated Laravel-inspired application framework built on Nest 11. Nest remains
the runtime composition kernel; feature code uses Canopy-owned actions, queries, models, events,
jobs, observers, policies, resources, notifications, cache, storage, broadcasting, and testing
APIs.

## Development

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm build
pnpm test
```

Run the API and worker separately with `pnpm dev:api` and `pnpm dev:worker`.

## Documentation

Start with the [developer documentation](docs/README.md) for Canopy's philosophy, architecture,
programming model, operational conventions, and comparison with Laravel.

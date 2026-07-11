# Package Reference

## Application-facing

- `@canopy/core` — stable programming model and framework-owned contracts.
- `@canopy/testing` — test harnesses, fakes, and assertions.
- `@canopy/arbor` — generator and command suite.

## Composition adapters

- `@canopy/http-hono`
- `@canopy/postgres-drizzle`
- `@canopy/auth-postgres`
- `@canopy/queue-pg-boss`
- `@canopy/sendgrid`
- `@canopy/twilio-sms`
- `@canopy/undergrowth`

Application and infrastructure composition may import these packages. Domain Features should rely on
Canopy-owned ports and types from `@canopy/core`.

## Framework infrastructure

- `@canopy/manifest`
- `@canopy/compiler`
- `@canopy/runtime`

These packages are published so first-party tooling and adapters can compose, but they are not the
ordinary application programming surface. Their direct use creates a deliberate compatibility
commitment and should be discussed before adoption.

# Package Reference

## Application-facing

- `@doxajs/core` — stable programming model and framework-owned contracts.
- `@doxajs/testing` — test harnesses, fakes, and assertions.
- `@doxajs/praxis` — generator and command suite.

## Composition adapters

- `@doxajs/http-hono`
- `@doxajs/postgres-drizzle`
- `@doxajs/auth-postgres`
- `@doxajs/queue-pg-boss`
- `@doxajs/sendgrid`
- `@doxajs/twilio-sms`
- `@doxajs/theoria`
- `@doxajs/keryx` — first-party WebSocket broadcasting server adapter.

## Realtime clients

- `@doxajs/realtime` — subscriber-facing WebSocket client with reconnect and resubscription.

Application events continue to use broadcasting contracts from `@doxajs/core`; Keryx and the
realtime client do not become the domain event vocabulary.

Application and infrastructure composition may import these packages. Domain Features should rely on
Doxa-owned ports and types from `@doxajs/core`.

## Framework infrastructure

- `@doxajs/manifest`
- `@doxajs/compiler`
- `@doxajs/runtime`

These packages are published so first-party tooling and adapters can compose, but they are not the
ordinary application programming surface. Their direct use creates a deliberate compatibility
commitment and should be discussed before adoption.

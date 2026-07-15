# `@doxajs/auth-postgres`

Framework-owned PostgreSQL authentication for Doxa: existing identity models, Argon2id credentials,
opaque browser sessions, opaque bearer tokens, verification and recovery challenges, durable abuse
controls, audit evidence, and existing-table mapping.

```sh
pnpm add @doxajs/auth-postgres
```

The package includes forward-only authentication migrations. Review the repository security policy
before production use; Doxa is currently pre-1.0.

Applications configure authentication through `framework.auth.identity` in root `app.config.ts` and
import only `Auth` from `@doxajs/core`. The concrete adapter is intentionally available from
`@doxajs/auth-postgres/framework` for generated framework code and migration from older alpha
applications. Direct `PostgresAuth` imports from the package root must move to that framework
subpath; direct table mappings should move into the compiled application configuration.

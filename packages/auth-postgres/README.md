# `@doxajs/auth-postgres`

> **Controlled-adoption prerelease:** Publicly downloadable under Apache-2.0; Midtown Home
> Improvements is the sole supported consumer. External use is permitted without compatibility,
> support, warranty, roadmap, or production-readiness commitments.

Framework-owned PostgreSQL authentication for Doxa: existing identity models, Argon2id credentials,
opaque browser sessions, opaque bearer tokens, verification and recovery challenges, durable abuse
controls, audit evidence, and existing-table mapping.

```sh
pnpm add @doxajs/auth-postgres
```

The package includes forward-only authentication migrations. Review the repository security policy
before production use; Doxa is currently pre-1.0.

Mapped authentication treats the configured external password column as the only credential
authority. `credentials.upgrade` defaults to `never`; the only writable policy is an explicit
in-place Doxa Argon2id replacement using compare-and-swap in the session/audit transaction. Password
sidecars are no longer supported. Verification sidecars remain supported.

Applications configure authentication through `framework.auth.identity` in root `app.config.ts` and
import only `Auth` from `@doxajs/core`. The concrete adapter is intentionally available from
`@doxajs/auth-postgres/framework` for generated framework code and migration from older alpha
applications. Direct `PostgresAuth` imports from the package root must move to that framework
subpath; direct table mappings should move into the compiled application configuration.

Applications upgrading from the alpha password-sidecar design must move every current sidecar record
into the appropriate external password column using a schema-specific locked compare-and-swap
transition. `0004_remove_mapped_password_sidecar.sql` fails while the obsolete table contains rows
and drops it only when empty; verification-sidecar creation is independently selected through
`0005_mapped_auth_verifications.sql`. See the
[authentication guide](../../docs/guides/authentication.md#removing-an-alpha-password-sidecar).

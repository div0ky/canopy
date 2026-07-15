# Authentication

Doxa Auth owns identities, password credentials, opaque browser sessions, opaque bearer access
tokens, verification and recovery challenges, abuse controls, and security audit records. Feature
code depends only on `Auth` from `@doxajs/core`; PostgreSQL authentication is generated framework
infrastructure.

With no auth identity configuration, Doxa owns the email identity and Argon2id credential tables. An
application can instead select one existing table-backed Model in root `app.config.ts`:

```ts
framework = {
  auth: {
    identity: {
      mode: 'managed',
      model: User,
      identifier: {
        kind: 'email',
        attribute: 'email',
        normalize: { preset: 'email-or-domain', domain: 'example.com' },
      },
      contactEmail: 'email',
      timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
      verification: { mode: 'mapped', attribute: 'emailVerifiedAt' },
      eligibility: [{ attribute: 'active', equals: true }],
      credentials: {
        table: 'users',
        identityId: 'id',
        readers: [{ preset: 'bcrypt', hash: 'password' }],
        write: { format: 'doxa-argon2id', destination: 'sidecar' },
      },
    },
  },
} as const
```

Model fields use logical attributes; credential fields deliberately use physical columns and never
enter ordinary Model state. `login-only` may use either a selected Model or a raw table mapping and
omits registration, verification, recovery, reset, and password-change routes. Use
`doxa auth:storage` or Gnosis `describe_authentication` to inspect the compiled mapping safely.

The public credential API uses `identifier` rather than an `email` alias. Identifiers can be exact,
lowercase, validated email, or email-with-default-domain normalized. Mapped readiness fails closed
unless keys, columns, types, writability, timestamps, credential cardinality, and normalization-
compatible uniqueness are valid.

Cookie-authenticated unsafe requests and WebSocket upgrades require a configured trusted `Origin`.
Bearer and cookie credentials may not be combined. Stored session, token, verification, and reset
credentials are digests; raw values are visible only when first issued.

Sensitive operations should require a recent password session:

```ts
if (!isRecentPasswordAuthentication(request.context.authentication)) {
  return deny('account', 'fresh_session_required')
}
```

The generated `POST /auth/reauthenticate` route verifies the current password, refreshes the named
live session's `authenticatedAt`, and records a security audit event. It does not create a new
identity, session, or authority model. The default freshness window is 15 minutes; applications may
pass a deliberate alternate window to `isRecentPasswordAuthentication`.

Password changes and resets revoke sessions according to the first-party Auth contract. Applications
should use generated routes and policies as the ordinary path and expose raw Auth methods only when
a transport-specific ceremony has equivalent validation, rate limiting, audit, and origin controls.

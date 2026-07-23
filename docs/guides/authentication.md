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
`doxa auth:storage` or Gnosis `describe_authentication` to inspect the compiled mapping safely. When
the selected identity table is maintained outside Doxa migrations, its Model declares
`static managed = false`; this is separate from the authentication `mode` shown above.

In `login-only` mode, a valid legacy SHA-256 credential may establish a session only when the write
destination is Doxa's password sidecar. Doxa first replaces the weak credential with its Argon2id
record in the same transaction that creates the session and audit event. Failure to persist any part
rolls back all three, and the external password column is never changed. Once present, the sidecar
record is authoritative. Externally owned and other non-sidecar login-only destinations continue to
reject weak credentials.

The public credential API uses `identifier` rather than an `email` alias. Identifiers can be exact,
lowercase, validated email, or email-with-default-domain normalized. Mapped readiness fails closed
unless keys, columns, types, writability, timestamps, credential cardinality, and normalization-
compatible uniqueness are valid.

The `email` identifier kind requires `email` or `email-or-domain` normalization; `username` and
`custom` identifiers use `exact` or `lowercase`. When `contactEmail` is absent, the compiled
identity reports email verification as `unsupported` and omits verification and recovery routes.

Cookie-authenticated unsafe requests and WebSocket upgrades require a configured trusted `Origin`.
Bearer and cookie credentials may not be combined. Authentication tables store session, bearer,
verification, and reset credentials as digests. Generated verification and recovery mail currently
copies the raw challenge into durable delivery payloads; that security-release blocker is tracked in
the
[2026-07-16 framework security audit](../../manifesto/implementation/security-audit-2026-07-16.md).

Sensitive operations should require a recent password session:

```ts
if (!isRecentPasswordAuthentication(request.context.authentication)) {
  return deny('account', 'fresh_session_required')
}
```

The generated `POST /auth/reauthenticate` route verifies the current password, refreshes the named
live session's `authenticatedAt`, and records a security audit event. It does not create a new
identity, session, or authority model. The default freshness window is 15 minutes; applications may
pass a deliberate alternate window to `isRecentPasswordAuthentication`. A legacy weak SHA-256
verifier is never sufficient for this sensitive-operation refresh in `login-only` mapping mode. A
valid legacy or current Argon2id verifier is upgraded transactionally before the session timestamp
is refreshed.

Opaque bearer credentials accept at most 100 unique authority constraints. Larger grants are
rejected before persistence so credential evaluation remains bounded.

Password changes and resets revoke sessions according to the first-party Auth contract. Applications
should use generated routes and policies as the ordinary path and expose raw Auth methods only when
a transport-specific ceremony has equivalent validation, rate limiting, audit, and origin controls.

# Authentication

Doxa Auth owns identities, password credentials, opaque browser sessions, opaque bearer access
tokens, verification and recovery challenges, abuse controls, and security audit records. Feature
code depends on `Auth` from `@doxajs/core`; PostgreSQL storage remains behind
`@doxajs/auth-postgres`.

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

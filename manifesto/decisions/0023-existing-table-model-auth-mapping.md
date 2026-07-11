# 0023: Map Models and Authentication to Existing Tables

- **Status:** Accepted
- **Accepted:** 2026-07-10
- **Implementation:** Complete for the MVP common path
- **Decision owners:** Canopy maintainers

## Decision

Canopy models and first-party authentication must be able to use existing PostgreSQL tables.
Ordinary single-table models receive Laravel-like static metadata overrides. Authentication uses
explicit table and field configuration because security-sensitive semantics must never be guessed.

This capability is required for adoption in established applications. Running Canopy beside an
existing database is insufficient if teams must copy authoritative users and domain records into
parallel `canopy_*` tables to receive the normal model and auth experience.

## Model experience

The common path should remain on the model and contain no Drizzle objects or SQL:

```ts
export class Customer extends Model<CustomerAttributes> {
  static table = 'legacy_customers'
  static primaryKey = 'customer_id'
  static versionColumn = 'lock_version'
  static timestamps = false

  static columns = {
    id: 'customer_id',
    displayName: 'display_name',
    active: 'is_active',
  } as const
}
```

Defaults should make mapped declarations smaller:

- Models use Canopy's entity-state storage until `static table` opts into an external table.
- Primary key defaults to `id`.
- Attribute names map directly unless `columns` overrides them.
- Timestamps default off; `static timestamps = true` maps `createdAt` and `updatedAt` to
  `created_at` and `updated_at`, while an object may override either column.
- Optimistic concurrency uses the declared version column, or PostgreSQL's `xmin` when no version
  column is available.
- `static table` alone is sufficient when only the table name differs.

The compiler records and validates the mapping. The runtime still owns hydration, identity maps,
dirty tracking, observers, `save()`, transactions, optimistic concurrency, journal, and outbox.
Changing the table must not downgrade those guarantees.

Composite keys, joined persistence, transformed values, multiple records, and unusual write
procedures use an explicit infrastructure mapper. That mapper is an advanced escape hatch, not
ceremony imposed on every model.

## Authentication experience

Auth mapping belongs in authentication configuration rather than an application `User` model.
Canopy Auth must remain usable without a domain user class, and it must know the exact security
meaning of every configured field:

```ts
super({
  connectionString: config.connectionString.reveal(),
  trustedOrigins: config.trustedOrigins,
  secureCookies: config.secureCookies,
  tables: {
    identities: {
      table: 'users',
      id: 'user_id',
      email: 'email_address',
      emailVerifiedAt: 'verified_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    passwords: {
      table: 'user_credentials',
      identityId: 'user_id',
      password: 'password_hash',
      updatedAt: 'updated_at',
    },
  },
})
```

Session, bearer-token, challenge, abuse, and audit tables continue using Canopy defaults unless
they are explicitly mapped. An application may therefore reuse its existing user and password
records without also adopting a legacy session design.

Auth configuration must validate required columns, uniqueness, nullability, hash format,
identifier compatibility, and writable operations before readiness. It must never infer password,
verification, revocation, or authority fields merely because a column has a familiar name.

The mapped password column stores a versioned Canopy Argon2id record. Existing non-Canopy password
formats remain a deferred adapter boundary: they require an explicit password-hasher adapter and a
reviewed upgrade strategy, normally verification with the legacy format followed by Argon2id rehash
on successful login. The MVP fails closed when it encounters an unknown stored format; it never
relabels that format or silently weakens password policy.

## Migration and ownership rules

- Arbor migrations create only unmapped Canopy-owned tables.
- Arbor reports mapped tables as externally owned and never alters them implicitly.
- Mapping validation is read-only during build and readiness checks.
- Destructive or lossy conversion requires an explicit generated migration or import command.
- Existing rows receive the same auth audit and application execution semantics as Canopy-owned
  rows.

## Required proof

1. A model with only `static table` hydrates, mutates, saves, refreshes, and deletes existing rows.
2. Key, column, timestamp, and version overrides retain observer and concurrency semantics.
3. Advanced multi-record mappers remain an explicit post-MVP extension point.
4. Auth can register and authenticate against mapped identity and credential tables.
5. Auth can map identities while retaining default Canopy session, token, challenge, and audit tables.
6. Unknown password formats fail closed; legacy hash adapters remain deferred.
7. Missing mapped columns and invalid identifiers fail before readiness; deeper type and uniqueness
   diagnostics remain a future hardening layer.
8. Arbor migration status and diagnostics distinguish owned from externally mapped tables.
9. First-party memory fakes reproduce the mapped attribute contract.

## Relationship to permissions

First-party roles and permission storage are deferred in
[Decision 0022](0022-defer-first-party-permissions.md). Existing-table mapping intentionally lands
first so future permission sources can integrate with established role and membership schemas.

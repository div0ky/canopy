# 0023: Map Models and Authentication to Existing Tables

- **Status:** Accepted
- **Accepted:** 2026-07-10
- **Amended:** 2026-07-14
- **Implementation:** Config-driven identity contract and direct table mapping are implemented and
  proven
- **Decision owners:** Doxa maintainers

## Decision

Doxa models and first-party authentication must be able to use existing PostgreSQL tables. Ordinary
single-table models receive Laravel-like static metadata overrides. Authentication uses explicit
table and field configuration because security-sensitive semantics must never be guessed.

This capability is required for adoption in established applications. Running Doxa beside an
existing database is insufficient if teams must copy authoritative users and domain records into
parallel `doxa_*` tables to receive the normal model and auth experience.

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

- Models use Doxa's entity-state storage until `static table` opts into an external table.
- Primary key defaults to `id`.
- Attribute names map directly unless `columns` overrides them.
- Timestamps default off; `static timestamps = true` maps `createdAt` and `updatedAt` to
  `created_at` and `updated_at`, while an object may override either column.
- Optimistic concurrency uses the declared version column, or PostgreSQL's `xmin` when no version
  column is available.
- `static table` alone is sufficient when only the table name differs.
- TypeScript-optional logical attributes map an absent value to SQL `NULL` and hydrate SQL `NULL`
  back to an absent attribute. Required attributes whose type explicitly includes `null` retain
  `null`; the compiler records that distinction in the table-storage artifact.

The compiler records and validates the mapping. The runtime still owns hydration, identity maps,
dirty tracking, observers, `save()`, transactions, optimistic concurrency, journal, and outbox.
Changing the table must not downgrade those guarantees.

Composite keys, joined persistence, transformed values, multiple records, and unusual write
procedures use an explicit infrastructure mapper. That mapper is an advanced escape hatch, not
ceremony imposed on every model.

## Authentication experience

Auth mapping belongs in the declaration-only `framework.auth.identity` configuration rather than an
application `User` model appointing itself globally. When the key is absent, Doxa uses its owned
email/password identity tables. When present, the compiler resolves one model-backed or raw-table
identity source into the canonical manifest and the generated PostgreSQL provider consumes only that
artifact. Application Features continue to depend on `Auth`; `PostgresAuth` remains framework
infrastructure.

The model-backed common path names logical attributes while credentials remain a separate,
security-owned mapping and never become ordinary model attributes:

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
        identityId: 'user_id',
        readers: [{ preset: 'bcrypt', hash: 'password_hash' }],
        write: { format: 'doxa-argon2id', destination: 'sidecar' },
      },
    },
  },
}
```

A raw `{ table, columns }` source remains a login-only escape hatch. Managed identity creation
requires a selected Doxa model, uses its normal persistence lifecycle, and may name a registration
factory for extra non-auth attributes. Identity IDs reuse the mapped single-column primary key.

The public credential input is `identifier`, not `email`. One configured identifier kind and
normalization preset governs login, registration, recovery, rate-limit buckets, and uniqueness.
Contact email is separately mapped and may be absent; email verification and recovery routes are
then omitted. Verification is a three-state contract (`verified`, `unverified`, `unsupported`) and
may use a mapped attribute, Doxa-owned sidecar, or explicitly trusted external state.

Session, bearer-token, challenge, abuse, and audit tables continue using Doxa defaults unless they
are explicitly mapped. An application may therefore reuse its existing user and password records
without also adopting a legacy session design.

Auth configuration must validate required columns, uniqueness, nullability, hash format, identifier
compatibility, and writable operations before readiness. It must never infer password, verification,
revocation, or authority fields merely because a column has a familiar name.

Credential readers are reviewed first-party presets. Doxa supports its versioned Argon2id record,
bcrypt variants used by Laravel, Argon2id PHC records, and an explicitly weak lowercase SHA-256
legacy reader. New writes always use Doxa Argon2id. Weak SHA-256 succeeds only when the same
transaction can persist its replacement before issuing a session; login-only mappings therefore
reject it. Upgrades explicitly target validated in-place storage or a Doxa-owned sidecar. Once a
sidecar credential exists it is authoritative and verification never falls back to the legacy hash.

Mapped verification attributes are Auth-owned. Ordinary model code may read but not write them.
Identifier and contact-email changes are normalized through the compiled contract, and contact-email
changes invalidate verification and outstanding challenges. Eligibility predicates are checked for
every cookie, bearer, password, and sensitive credential resolution; an ineligible identity fails
closed and revokes all Doxa sessions and tokens.

## Migration and ownership rules

- Praxis migrations create always-owned session, token, challenge, abuse, and audit tables plus only
  the identity, credential, or sidecar tables selected by the compiled storage contract.
- Praxis reports mapped tables as externally owned and never alters them implicitly.
- Mapping validation is read-only during build and readiness checks.
- Destructive or lossy conversion requires an explicit generated migration or import command.
- Existing rows receive the same auth audit and application execution semantics as Doxa-owned rows.

## Required proof

1. A model with only `static table` hydrates, mutates, saves, refreshes, and deletes existing rows.
2. Key, column, timestamp, version, and optional-attribute overrides retain observer, dirty-state,
   and concurrency semantics.
3. Advanced multi-record mappers remain an explicit post-MVP extension point.
4. Auth can register through a mapped model and authenticate against mapped identity and credential
   tables without exposing credential columns as model attributes.
5. Auth can map identities while retaining default Doxa session, token, challenge, and audit tables.
6. Unknown password formats fail closed; bcrypt, Argon2id PHC, and mandatory-upgrade SHA-256 readers
   have known-answer and negative-path proof.
7. Missing mapped columns, invalid identifiers, incompatible types/nullability, non-unique
   normalized identifiers, and non-writable managed mappings fail before readiness.
8. Praxis migration status and diagnostics distinguish owned from externally mapped tables.
9. First-party memory fakes reproduce the mapped attribute contract.
10. Login-only route generation omits unsupported identity and credential mutation flows.
11. Praxis and Gnosis expose safe mapping metadata but never credential values.

## Relationship to permissions

First-party roles and permission storage are deferred in
[Decision 0022](0022-defer-first-party-permissions.md). Existing-table mapping landed first; the
application permission source accepted by [Decision 0034](0034-application-permission-sources.md)
now integrates established role and membership schemas without making them Doxa-owned storage.

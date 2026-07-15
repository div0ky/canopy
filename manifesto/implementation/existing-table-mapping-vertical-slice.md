# Existing-Table Model and Authentication Mapping

- **Status:** Implemented MVP common path
- **Implemented:** 2026-07-10
- **Manifest format:** 4
- **Decision:**
  [Map models and authentication to existing tables](../decisions/0023-existing-table-model-auth-mapping.md)

## Outcome

Doxa can adopt an existing PostgreSQL schema without replacing authoritative domain or user tables.
The ordinary experience stays class-first and Laravel-like: a model declares physical metadata, then
uses the same `find()`, mutation, `save()`, `refresh()`, and `delete()` APIs as any other Doxa
model.

```ts
export class Customer extends Model<CustomerAttributes> {
  static override readonly id = 'customer'
  static override readonly table = 'legacy_customers'
  static override readonly primaryKey = 'customer_id'
  static override readonly versionColumn = 'lock_version'
  static override readonly timestamps = true
  static override readonly columns = {
    id: 'customer_id',
    displayName: 'full_name',
    active: 'enabled',
  } as const
}
```

`static table` opts a model into table mapping. The primary key defaults to `id`, attributes map to
same-named columns unless overridden, timestamps default off, and optimistic concurrency uses
PostgreSQL `xmin` when no explicit version column exists. Mapping metadata is compiled into the
canonical manifest; folders and runtime reflection remain irrelevant.

The PostgreSQL adapter quotes every compiler-validated identifier and retains the normal model
contract: execution identity, hydration, dirty tracking, observers, journal/outbox staging,
transactional commit, and optimistic-concurrency failures. It never copies mapped state into
`doxa_entity_states`.

## Authentication mapping

Root application configuration selects an existing identity Model and logical attributes:

```ts
framework = {
  auth: {
    identity: {
      mode: 'managed',
      model: User,
      identifier: {
        kind: 'email',
        attribute: 'email',
        normalize: { preset: 'email' },
      },
      contactEmail: 'email',
      timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
      verification: { mode: 'mapped', attribute: 'emailVerifiedAt' },
      credentials: {
        table: 'user_credentials',
        identityId: 'user_id',
        readers: [{ preset: 'bcrypt', hash: 'password_hash' }],
        write: { format: 'doxa-argon2id', destination: 'sidecar' },
      },
    },
  },
} as const
```

Identity IDs are opaque text rather than assumed UUIDs. Identity and password data may share one
external table or use separate external tables. Browser sessions, bearer tokens, challenges, abuse
controls, and audit records remain in Doxa-owned tables, preserving secure framework semantics
without forcing an established application to replace its users table.

The compiler resolves logical attributes to physical storage in the authentication artifact. Mapped
columns are checked during lifecycle readiness. Missing or incompatible columns, composite keys,
unsafe uniqueness, unwritable managed fields, and duplicate credential rows prevent readiness. Doxa
never migrates an external table implicitly.

## Inspection and AI knowledge

`doxa model:list` reports each model's physical table, ownership, key, and concurrency source.
`doxa auth:storage` reports which auth records are externally mapped and which remain Doxa-owned.
The model storage contract is also emitted in `.doxa/gnosis.json`, so Gnosis can make safe changes
without inferring persistence from filenames or application code.

## Executable evidence

The PostgreSQL conformance suite proves:

1. Existing mapped rows hydrate, mutate, save, refresh, and delete.
2. Explicit version columns and implicit `xmin` both detect competing writes.
3. Journal and outbox records commit atomically while generic entity-state rows remain absent.
4. Registration, email verification, cookie login, bearer resolution, password change, and auth
   audit work with an arbitrary external text identity ID.
5. Missing mapped columns fail before readiness.
6. The first-party memory transaction manager preserves the logical mapped-model contract.
7. Praxis and Gnosis expose storage ownership and mapping metadata.

Multiple identity realms, separate auth databases, permission mapping, OAuth, MFA, and application-
defined hashers remain explicit future work.

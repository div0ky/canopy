# Existing-Table Model and Authentication Mapping

- **Status:** Implemented MVP common path
- **Implemented:** 2026-07-10
- **Manifest format:** 10
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

First-party auth accepts explicit identity and credential mappings:

```ts
new PostgresAuth({
  connectionString,
  trustedOrigins: ['https://example.com'],
  secureCookies: true,
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
      password: 'password_record',
      updatedAt: 'updated_at',
    },
  },
})
```

Identity IDs are opaque text rather than assumed UUIDs. Identity and password data may share one
external table or use separate external tables. Browser sessions, bearer tokens, challenges, abuse
controls, and audit records remain in Doxa-owned tables, preserving secure framework semantics
without forcing an established application to replace its users table.

Mapped columns are checked during lifecycle readiness. Identifiers are validated before any SQL is
issued, missing columns prevent readiness, unknown password record formats fail closed, and
registration across separate identity and password tables uses one PostgreSQL transaction. Doxa
never migrates the external tables implicitly.

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

Advanced multi-record model mappers, legacy password-hasher adapters, deeper database type and
uniqueness diagnostics, and first-party permission storage remain explicit future work.

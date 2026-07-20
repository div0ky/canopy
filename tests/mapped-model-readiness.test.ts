import type { ModelStorage } from '@doxajs/core'
import { describe, expect, it } from 'vitest'

import {
  hydrateMappedState,
  mappedModelProjection,
  mappedModelVersionSource,
  type ModelColumnMetadata,
  validateMappedModelReadiness,
} from '../packages/postgres-drizzle/src/postgres-transaction-manager.js'

type TableStorage = Extract<ModelStorage, { readonly kind: 'table' }>

const mappedStorage: TableStorage = {
  kind: 'table',
  table: 'legacy_contacts',
  primaryKey: 'contact_id',
  columns: {
    id: 'contact_id',
    displayName: 'display_name',
  },
  attributeTypes: {
    id: { kind: 'string', nullable: false, optional: false },
    displayName: { kind: 'string', nullable: false, optional: false },
  },
  timestamps: false,
  managed: false,
  readOnly: false,
  versionSource: { kind: 'xmin' },
}

const idColumn = column('contact_id', 'uuid')
const displayNameColumn = column('display_name', 'text')

describe('mapped-model PostgreSQL readiness contract', () => {
  it('uses a non-concurrency version for read-only relations without a version column', () => {
    expect(mappedModelVersionSource(mappedStorage)).toEqual({ kind: 'xmin' })
    expect(
      mappedModelVersionSource({
        ...mappedStorage,
        readOnly: true,
        versionSource: { kind: 'none' },
      }),
    ).toEqual({
      kind: 'none',
    })
    expect(
      mappedModelVersionSource({
        ...mappedStorage,
        readOnly: true,
        versionColumn: 'revision',
        versionSource: { kind: 'column', column: 'revision' },
      }),
    ).toEqual({ kind: 'column', column: 'revision' })
    expect(() =>
      mappedModelVersionSource({
        ...mappedStorage,
        readOnly: true,
      }),
    ).toThrow('version source is inconsistent')
  })

  it('aliases declared columns away from adapter metadata names', () => {
    expect(
      mappedModelProjection({
        ...mappedStorage,
        primaryKey: '__doxa_version',
        columns: {
          id: '__doxa_version',
          displayName: '__doxa_id',
        },
      }),
    ).toEqual([
      {
        attribute: 'id',
        column: '__doxa_version',
        alias: '__doxa_attribute_0',
      },
      {
        attribute: 'displayName',
        column: '__doxa_id',
        alias: '__doxa_attribute_1',
      },
    ])
  })

  it('fails hydration when a required projected attribute is null', () => {
    expect(() =>
      hydrateMappedState(
        {
          __doxa_attribute_0: 'contact-1',
          __doxa_attribute_1: null,
          __doxa_version: 0,
        },
        mappedStorage,
      ),
    ).toThrow('returned NULL for required attribute displayName')
  })

  it('accepts unrelated additional columns and PostgreSQL enum scalars', () => {
    const enumDisplayName = column('display_name', 'contact_name', { typeKind: 'e' })
    expect(() =>
      validateMappedModelReadiness(
        'model:contacts/contact',
        mappedStorage,
        'r',
        [
          idColumn,
          enumDisplayName,
          column('password_hash', 'text', { hasDefault: true }),
          column('vendor_state', 'text', { notNull: false }),
        ],
        ['contact_id'],
      ),
    ).not.toThrow()
  })

  it('rejects missing relations, mapped columns, incompatible types, and nullability', () => {
    expect(() =>
      validateMappedModelReadiness('model:contacts/contact', mappedStorage, undefined, [], []),
    ).toThrow('does not exist')
    expect(() =>
      validateMappedModelReadiness(
        'model:contacts/contact',
        mappedStorage,
        'r',
        [idColumn],
        ['contact_id'],
      ),
    ).toThrow('references missing column display_name')
    expect(() =>
      validateMappedModelReadiness(
        'model:contacts/contact',
        mappedStorage,
        'r',
        [idColumn, column('display_name', 'bool')],
        ['contact_id'],
      ),
    ).toThrow('incompatible with PostgreSQL type bool')
    expect(() =>
      validateMappedModelReadiness(
        'model:contacts/contact',
        mappedStorage,
        'r',
        [idColumn, column('display_name', 'text', { notNull: false })],
        ['contact_id'],
      ),
    ).toThrow('incompatible nullability')
  })

  it('rejects invalid keys, generated writable mappings, and impossible inserts', () => {
    expect(() =>
      validateMappedModelReadiness(
        'model:contacts/contact',
        mappedStorage,
        'r',
        [idColumn, displayNameColumn],
        ['tenant_id', 'contact_id'],
      ),
    ).toThrow('requires single-column primary key contact_id')
    expect(() =>
      validateMappedModelReadiness(
        'model:contacts/contact',
        mappedStorage,
        'r',
        [idColumn, column('display_name', 'text', { generated: true })],
        ['contact_id'],
      ),
    ).toThrow('uses generated column display_name')
    expect(() =>
      validateMappedModelReadiness(
        'model:contacts/contact',
        mappedStorage,
        'r',
        [idColumn, displayNameColumn, column('required_vendor_value', 'text')],
        ['contact_id'],
      ),
    ).toThrow('undeclared column required_vendor_value is required and has no default')
  })

  it('requires views to be read-only and permits their unrelated required columns', () => {
    expect(() =>
      validateMappedModelReadiness(
        'model:contacts/contact',
        mappedStorage,
        'v',
        [idColumn, displayNameColumn],
        [],
      ),
    ).toThrow('must declare readOnly = true')

    const readOnlyStorage: TableStorage = {
      ...mappedStorage,
      readOnly: true,
      versionSource: { kind: 'none' },
    }
    expect(() =>
      validateMappedModelReadiness(
        'model:contacts/contact',
        readOnlyStorage,
        'm',
        [
          column('contact_id', 'uuid', { notNull: false }),
          column('display_name', 'text', { generated: true, notNull: false }),
          column('required_vendor_value', 'text'),
        ],
        [],
      ),
    ).not.toThrow()
  })

  it('validates version and timestamp infrastructure behavior', () => {
    const versioned: TableStorage = {
      ...mappedStorage,
      versionColumn: 'lock_version',
      versionSource: { kind: 'column', column: 'lock_version' },
      timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    }
    expect(() =>
      validateMappedModelReadiness(
        'model:contacts/contact',
        versioned,
        'r',
        [
          idColumn,
          displayNameColumn,
          column('lock_version', 'text'),
          column('created_at', 'timestamptz'),
          column('updated_at', 'timestamptz'),
        ],
        ['contact_id'],
      ),
    ).toThrow('version column lock_version')
    expect(() =>
      validateMappedModelReadiness(
        'model:contacts/contact',
        versioned,
        'r',
        [
          idColumn,
          displayNameColumn,
          column('lock_version', 'int4'),
          column('created_at', 'timestamptz'),
          column('updated_at', 'text'),
        ],
        ['contact_id'],
      ),
    ).toThrow('timestamp column updated_at')
  })
})

function column(
  name: string,
  type: string,
  overrides: Partial<ModelColumnMetadata> = {},
): ModelColumnMetadata {
  return {
    name,
    type,
    typeKind: 'b',
    notNull: true,
    generated: false,
    identity: false,
    hasDefault: false,
    ...overrides,
  }
}

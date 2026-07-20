import type { ModelStorage } from '@doxajs/core'
import { describe, expect, it } from 'vitest'

import {
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
}

const idColumn = column('contact_id', 'uuid')
const displayNameColumn = column('display_name', 'text')

describe('mapped-model PostgreSQL readiness contract', () => {
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

    const readOnlyStorage = { ...mappedStorage, readOnly: true }
    expect(() =>
      validateMappedModelReadiness(
        'model:contacts/contact',
        readOnlyStorage,
        'm',
        [
          idColumn,
          column('display_name', 'text', { generated: true }),
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

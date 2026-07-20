import { Model, type ModelAttributes } from '@doxajs/core'

export interface LegacyCustomerReadAttributes extends ModelAttributes {
  id: string
  displayName: string
}

export class LegacyCustomerReadModel extends Model<LegacyCustomerReadAttributes> {
  static override readonly id = 'legacy-customer-read-model'
  static override readonly table = 'legacy_customers'
  static override readonly primaryKey = 'customer_id'
  static override readonly versionColumn = 'lock_version'
  static override readonly managed = false
  static override readonly readOnly = true
  static override readonly columns = {
    id: 'customer_id',
    displayName: 'full_name',
  } as const

  get displayName(): string {
    return this.attributes.displayName
  }
}

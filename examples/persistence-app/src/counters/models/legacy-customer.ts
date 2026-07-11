import { Model, type ModelAttributes } from '@doxajs/core'

export interface LegacyCustomerAttributes extends ModelAttributes {
  id: string
  displayName: string
  active: boolean
}

export class LegacyCustomer extends Model<LegacyCustomerAttributes> {
  static override readonly id = 'legacy-customer'
  static override readonly table = 'legacy_customers'
  static override readonly primaryKey = 'customer_id'
  static override readonly versionColumn = 'lock_version'
  static override readonly timestamps = true
  static override readonly columns = {
    id: 'customer_id',
    displayName: 'full_name',
    active: 'enabled',
  } as const

  get displayName(): string {
    return this.attributes.displayName
  }
  get active(): boolean {
    return this.attributes.active
  }

  rename(displayName: string): void {
    this.attributes.displayName = displayName
    this.journal('legacy-customer.renamed', { displayName })
    this.outbox('legacy-customer.changed', { customerId: this.id })
  }
}

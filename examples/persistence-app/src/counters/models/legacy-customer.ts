import { Model, type ModelAttributes } from '@doxajs/core'

export interface LegacyCustomerAttributes extends ModelAttributes {
  id: string
  displayName: string
  active: boolean
  nickname?: string
  nullableCode: string | null
}

export class LegacyCustomer extends Model<LegacyCustomerAttributes> {
  static override readonly id = 'legacy-customer'
  static override readonly table = 'legacy_customers'
  static override readonly managed = false
  static override readonly primaryKey = 'customer_id'
  static override readonly versionColumn = 'lock_version'
  static override readonly timestamps = true
  static override readonly columns = {
    id: 'customer_id',
    displayName: 'full_name',
    active: 'enabled',
    nullableCode: 'nullable_code',
  } as const

  get displayName(): string {
    return this.attributes.displayName
  }
  get active(): boolean {
    return this.attributes.active
  }
  get nickname(): string | undefined {
    return this.attributes.nickname
  }
  get nullableCode(): string | null {
    return this.attributes.nullableCode
  }

  rename(displayName: string): void {
    this.attributes.displayName = displayName
    this.journal('legacy-customer.renamed', { displayName })
    this.outbox('legacy-customer.changed', { customerId: this.id })
  }

  recordActivity(): void {
    this.journal('legacy-customer.activity-recorded', { customerId: this.id })
    this.outbox('legacy-customer.activity-recorded', { customerId: this.id })
  }
}

import { Action } from '@doxajs/core'

import { LegacyCustomer } from '../models/legacy-customer.js'

export class RecordLegacyCustomerActivity extends Action<
  string,
  { readonly saved: boolean; readonly version: number }
> {
  static readonly id = 'record-legacy-customer-activity'
  static override readonly access = 'public'

  async handle(id: string): Promise<{ readonly saved: boolean; readonly version: number }> {
    const customer = await LegacyCustomer.findOrFail(id)
    customer.recordActivity()
    const saved = await customer.save()
    return { saved, version: customer.version! }
  }
}

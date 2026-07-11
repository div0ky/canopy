import { Action } from '@doxajs/core'

import { LegacyCustomer } from '../models/legacy-customer.js'

export class DeleteLegacyCustomer extends Action<string, void> {
  static id = 'delete-legacy-customer'
  static override readonly access = 'public'

  async handle(id: string): Promise<void> {
    const customer = await LegacyCustomer.findOrFail(id)
    await customer.refresh()
    await customer.delete()
  }
}

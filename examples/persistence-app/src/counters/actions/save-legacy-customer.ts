import { Action } from '@doxajs/core'

import { LegacyCustomer } from '../models/legacy-customer.js'

export interface SaveLegacyCustomerInput {
  readonly id: string
  readonly displayName: string
  readonly nickname?: string | undefined
  readonly delayAfterLoad?: number
}

export class SaveLegacyCustomer extends Action<
  SaveLegacyCustomerInput,
  { id: string; displayName: string; version: number; created: boolean }
> {
  static id = 'save-legacy-customer'
  static override readonly access = 'public'

  async handle(
    input: SaveLegacyCustomerInput,
  ): Promise<{ id: string; displayName: string; version: number; created: boolean }> {
    const customer =
      (await LegacyCustomer.find(input.id)) ??
      LegacyCustomer.make({
        id: input.id,
        displayName: input.displayName,
        active: true,
        nullableCode: null,
      })
    const created = !customer.exists
    if (input.delayAfterLoad)
      await new Promise((resolve) => setTimeout(resolve, input.delayAfterLoad))
    customer.rename(input.displayName)
    if (Object.hasOwn(input, 'nickname')) customer.setAttribute('nickname', input.nickname)
    await customer.save()
    return {
      id: customer.id,
      displayName: customer.displayName,
      version: customer.version!,
      created,
    }
  }
}

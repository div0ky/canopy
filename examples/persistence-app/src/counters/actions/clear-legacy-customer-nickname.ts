import { Action } from '@doxajs/core'

import { LegacyCustomer } from '../models/legacy-customer.js'

export class ClearLegacyCustomerNickname extends Action<
  string,
  { nickname: string | undefined; nullableCode: string | null; saved: boolean; version: number }
> {
  static readonly id = 'clear-legacy-customer-nickname'
  static override readonly access = 'public'

  async handle(id: string): Promise<{
    nickname: string | undefined
    nullableCode: string | null
    saved: boolean
    version: number
  }> {
    const customer = await LegacyCustomer.findOrFail(id)
    customer.setAttribute('nickname', undefined)
    const saved = await customer.save()
    return {
      nickname: customer.nickname,
      nullableCode: customer.nullableCode,
      saved,
      version: customer.version!,
    }
  }
}

import { Action } from '@doxajs/core'

import { LegacyCustomerReadModel } from '../models/legacy-customer-read-model.js'

export type ReadOnlyLegacyCustomerOperation =
  'read' | 'save' | 'delete' | 'create' | 'make' | 'read-suite' | 'unknown' | 'fill-unknown'

export class ExerciseReadOnlyLegacyCustomer extends Action<
  { readonly id: string; readonly operation: ReadOnlyLegacyCustomerOperation },
  string
> {
  static readonly id = 'exercise-read-only-legacy-customer'
  static override readonly access = 'public'

  async handle(input: {
    readonly id: string
    readonly operation: ReadOnlyLegacyCustomerOperation
  }): Promise<string> {
    if (input.operation === 'make') {
      const model = LegacyCustomerReadModel.make({
        id: input.id,
        displayName: 'Made in memory',
      })
      model.setAttribute('displayName', 'Changed in memory')
      return model.displayName
    }
    if (input.operation === 'create') {
      const created = await LegacyCustomerReadModel.create({
        id: input.id,
        displayName: 'Created in memory',
      })
      return created.displayName
    }
    const customer = await LegacyCustomerReadModel.findOrFail(input.id)
    if (input.operation === 'read') return customer.displayName
    if (input.operation === 'read-suite') {
      await customer.refresh()
      const queried = await LegacyCustomerReadModel.where({ id: input.id }).get()
      const count = await LegacyCustomerReadModel.where({ id: input.id }).count()
      const page = await LegacyCustomerReadModel.where({ id: input.id }).paginate({
        page: 1,
        perPage: 1,
      })
      const cursorPage = await LegacyCustomerReadModel.where({ id: input.id }).cursorPaginate({
        first: 1,
      })
      let cursorCount = 0
      for await (const _entry of LegacyCustomerReadModel.where({ id: input.id }).cursor({
        batchSize: 1,
      })) {
        cursorCount += 1
      }
      return [
        queried[0]?.displayName,
        count,
        page.items.length,
        cursorPage.items.length,
        cursorCount,
      ].join(':')
    }
    if (input.operation === 'unknown') {
      return String(
        (
          customer as unknown as {
            getAttribute(key: string): unknown
          }
        ).getAttribute('password_hash'),
      )
    }
    if (input.operation === 'fill-unknown') {
      ;(
        customer as unknown as {
          fill(attributes: Record<string, unknown>): LegacyCustomerReadModel
        }
      ).fill({ vendorState: 'attempted overwrite' })
      return customer.displayName
    }
    if (input.operation === 'delete') {
      await customer.delete()
      return customer.displayName
    }
    customer.setAttribute('displayName', 'Changed in memory')
    await customer.save()
    return customer.displayName
  }
}

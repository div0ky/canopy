import { Action, DeliveryLedger, type DeliveryTransition } from '@canopy/core'

export class RecordDeliveryUpdates extends Action<readonly DeliveryTransition[], void> {
  static id = 'record-delivery-updates'
  static override readonly access = 'public'
  constructor(private readonly ledger: DeliveryLedger) { super() }
  async handle(updates: readonly DeliveryTransition[]): Promise<void> {
    for (const update of updates) await this.ledger.record(update)
  }
}

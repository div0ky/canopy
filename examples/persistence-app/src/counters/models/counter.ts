import { Model, type ModelAttributes } from '@canopy/core'

import { CounterIncremented } from '../events/counter-incremented.js'
import { CounterSaved } from '../events/counter-saved.js'

export interface CounterAttributes extends ModelAttributes {
  id: string
  value: number
  label?: string
}

export class Counter extends Model<CounterAttributes> {
  static override readonly id = 'counter'

  get value(): number {
    return this.attributes.value
  }

  get label(): string | undefined {
    return this.attributes.label
  }

  rename(label?: string): void {
    if (label === undefined) {
      delete this.attributes.label
      return
    }
    this.attributes.label = label
  }

  increment(amount: number): void {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error('Counter increments must be positive integers.')
    }
    this.attributes.value += amount
    this.journal('counter.incremented', {
      amount,
      value: this.attributes.value,
    })
    this.outbox('counter.changed', {
      counterId: this.id,
      value: this.attributes.value,
    })
  }

  async dispatchIncremented(amount: number): Promise<void> {
    await CounterIncremented.dispatch(this.id, amount, this.value)
    await CounterSaved.dispatch(this.id, this.value)
  }

  markForDeletion(): void {
    this.journal('counter.deleted', { value: this.attributes.value })
    this.outbox('counter.deleted', { counterId: this.id })
  }
}

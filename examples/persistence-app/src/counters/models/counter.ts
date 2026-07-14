import {
  belongsTo,
  belongsToMany,
  hasMany,
  hasOne,
  Model,
  type ModelAttributes,
  type ModelRelationship,
} from '@doxajs/core'

import { CounterIncremented } from '../events/counter-incremented.js'
import { CounterSaved } from '../events/counter-saved.js'

export interface CounterAttributes extends ModelAttributes {
  id: string
  value: number
  label?: string
}

export interface CounterRelations {
  notes: readonly CounterNote[]
  primaryNote: CounterNote | undefined
  tags: readonly CounterTag[]
}

export class Counter extends Model<CounterAttributes, CounterRelations> {
  static override readonly id = 'counter'
  static override readonly relationships: Readonly<Record<string, ModelRelationship>> = {
    notes: hasMany(() => CounterNote, { foreignKey: 'counterId' }),
    primaryNote: hasOne(() => CounterNote, { foreignKey: 'counterId' }),
    tags: belongsToMany(() => CounterTag, {
      through: () => CounterTagAssignment,
      foreignKey: 'counterId',
      relatedForeignKey: 'tagId',
    }),
  } as const

  get value(): number {
    return this.attributes.value
  }

  get label(): string | undefined {
    return this.attributes.label
  }

  get notes(): readonly CounterNote[] {
    return this.related('notes')
  }

  get primaryNote(): CounterNote | undefined {
    return this.related('primaryNote')
  }

  get tags(): readonly CounterTag[] {
    return this.related('tags')
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
    await CounterIncremented.dispatch({ counterId: this.id, amount, value: this.value })
    await CounterSaved.dispatch({ counterId: this.id, value: this.value })
  }

  markForDeletion(): void {
    this.journal('counter.deleted', { value: this.attributes.value })
    this.outbox('counter.deleted', { counterId: this.id })
  }
}

export interface CounterNoteAttributes extends ModelAttributes {
  id: string
  counterId: string
  body: string
  rank: number
}

export interface CounterNoteRelations {
  counter: Counter
}

export class CounterNote extends Model<CounterNoteAttributes, CounterNoteRelations> {
  static override readonly id = 'counter-note'
  static override readonly relationships: Readonly<Record<string, ModelRelationship>> = {
    counter: belongsTo(() => Counter, { foreignKey: 'counterId' }),
  } as const

  get counterId(): string {
    return this.attributes.counterId
  }

  get body(): string {
    return this.attributes.body
  }

  get rank(): number {
    return this.attributes.rank
  }

  get counter(): Counter {
    return this.related('counter')
  }
}

export interface CounterTagAttributes extends ModelAttributes {
  id: string
  name: string
}

export interface CounterTagRelations {
  counters: readonly Counter[]
}

export class CounterTag extends Model<CounterTagAttributes, CounterTagRelations> {
  static override readonly id = 'counter-tag'
  static override readonly relationships: Readonly<Record<string, ModelRelationship>> = {
    counters: belongsToMany(() => Counter, {
      through: () => CounterTagAssignment,
      foreignKey: 'tagId',
      relatedForeignKey: 'counterId',
    }),
  }

  get name(): string {
    return this.attributes.name
  }

  get counters(): readonly Counter[] {
    return this.related('counters')
  }
}

export interface CounterTagAssignmentAttributes extends ModelAttributes {
  id: string
  counterId: string
  tagId: string
}

export class CounterTagAssignment extends Model<CounterTagAssignmentAttributes> {
  static override readonly id = 'counter-tag-assignment'
}

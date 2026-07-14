import { Counter, CounterNote } from '../examples/persistence-app/dist/counters/models/counter.js'

function modelQueryTypeProofs(): void {
  Counter.where({ value: 1 }).orderBy('value')
  Counter.with('notes')
  Counter.with('notes.counter')
  Counter.with({ notes: (query) => query.where('rank', '>=', 1).orderBy('body') })
  CounterNote.query().whereBelongsTo(new Counter({ id: 'counter', value: 1 }), 'counter')

  // @ts-expect-error Unknown model attributes fail at compilation.
  Counter.where({ unknown: true })
  // @ts-expect-error Unknown relationship names fail at compilation.
  Counter.with('unknown')
  // @ts-expect-error Constrained eager-load callbacks retain the related model's attributes.
  Counter.with({ notes: (query) => query.where('unknown', true) })
}

void modelQueryTypeProofs

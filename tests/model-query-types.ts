import { Counter, CounterNote } from '../examples/persistence-app/dist/counters/models/counter.js'

function modelQueryTypeProofs(): void {
  Counter.where({ value: 1 }).orderBy('value')
  Counter.with('notes')
  Counter.with('notes.counter')
  Counter.with({ notes: (query) => query.where('rank', '>=', 1).orderBy('body') })
  CounterNote.query().whereBelongsTo(new Counter({ id: 'counter', value: 1 }), 'counter')
  Counter.query().whereHas('notes', (query) => query.where('rank', '>=', 1))

  // @ts-expect-error Unknown model attributes fail at compilation.
  Counter.where({ unknown: true })
  // @ts-expect-error Unknown relationship names fail at compilation.
  Counter.with('unknown')
  // @ts-expect-error Unknown nested relationship names fail at compilation.
  Counter.with('notes.unknown')
  // @ts-expect-error Constrained eager-load callbacks retain the related model's attributes.
  Counter.with({ notes: (query) => query.where('unknown', true) })
  // @ts-expect-error Relationship-existence callbacks retain the related model's attributes.
  Counter.query().whereHas('notes', (query) => query.where('unknown', true))
  // @ts-expect-error Pattern comparisons require string attributes.
  Counter.where('value', 'like', 1)
  // @ts-expect-error Undefined is not a query value; use a null predicate for missing attributes.
  Counter.where({ label: undefined })
  // @ts-expect-error Numeric aggregates require numeric attributes.
  Counter.query().sum('label')
}

void modelQueryTypeProofs

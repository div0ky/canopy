import { CurrentExecution, Observer } from '@doxajs/core'

import { Counter } from '../models/counter.js'
import { observerLog } from '../../support/observer-log.js'

export class CounterObserver extends Observer<Counter> {
  static id = 'counter'

  private readonly execution = this.inject(CurrentExecution)

  retrieved(model: Counter): void {
    this.record('retrieved', model)
  }
  saving(model: Counter): void {
    this.record('saving', model)
  }
  creating(model: Counter): void {
    this.record('creating', model)
  }
  updating(model: Counter): void {
    this.record('updating', model)
  }
  created(model: Counter): void {
    this.record('created', model)
  }
  updated(model: Counter): void {
    this.record('updated', model)
  }
  saved(model: Counter): void {
    this.record('saved', model)
  }
  committed(model: Counter): void {
    this.record('committed', model)
  }

  private record(phase: string, model: Counter): void {
    observerLog.push({
      phase,
      modelId: model.id,
      correlationId: this.execution.context.correlationId,
      value: model.value,
      ...(model.version === undefined ? {} : { version: model.version }),
    })
  }
}

import type { Model } from './model.js'
import { CanopyRole } from './role.js'

export type ModelObserverPhase =
  'retrieved' | 'saving' | 'creating' | 'updating' | 'created' | 'updated' | 'saved' | 'committed'

export interface ModelObserverDispatcher {
  dispatch(phase: ModelObserverPhase, model: Model): void | Promise<void>
}

/** Synchronous model lifecycle coordination. Remote effects belong in queued listeners. */
export abstract class Observer<Instance extends Model = Model> extends CanopyRole {
  retrieved(_model: Instance): void | Promise<void> {}
  saving(_model: Instance): void | Promise<void> {}
  creating(_model: Instance): void | Promise<void> {}
  updating(_model: Instance): void | Promise<void> {}
  created(_model: Instance): void | Promise<void> {}
  updated(_model: Instance): void | Promise<void> {}
  saved(_model: Instance): void | Promise<void> {}
  committed(_model: Instance): void | Promise<void> {}
}

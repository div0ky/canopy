import { recordedEvents, type RecordedEvent } from '../../support/recorded-events.js'

export class CounterEventRecorder {
  static id = 'counter-event-recorder'

  record(event: RecordedEvent): void {
    recordedEvents.push(Object.freeze({ ...event }))
  }
}

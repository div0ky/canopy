import {
  recordedEvents,
  type RecordedEvent,
} from '../../support/recorded-events.js'

export class SystemEventRecorder {
  static id = 'system-event-recorder'

  record(event: RecordedEvent): void {
    recordedEvents.push(Object.freeze({ ...event }))
  }
}

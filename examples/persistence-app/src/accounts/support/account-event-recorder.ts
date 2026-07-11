import {
  recordedEvents,
  type RecordedEvent,
} from '../../support/recorded-events.js'

export class AccountEventRecorder {
  static readonly id = 'account-event-recorder'

  record(event: RecordedEvent): void {
    recordedEvents.push(Object.freeze({ ...event }))
  }
}

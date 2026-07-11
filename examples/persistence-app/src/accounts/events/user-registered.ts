import { Event } from '@canopy/core'

export class UserRegistered extends Event {
  static override readonly id = 'user-registered'

  constructor(readonly identityId: string) {
    super()
  }
}

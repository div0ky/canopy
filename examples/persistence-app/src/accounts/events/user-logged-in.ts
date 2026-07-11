import { Event } from '@canopy/core'

export class UserLoggedIn extends Event {
  static override readonly id = 'user-logged-in'

  constructor(
    readonly identityId: string,
    readonly sessionId: string,
  ) {
    super()
  }
}

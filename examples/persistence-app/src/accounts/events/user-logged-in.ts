import { Event } from '@canopy/core'

export class UserLoggedIn extends Event<{ identityId: string; sessionId: string }> {
  static override readonly id = 'user-logged-in'
}

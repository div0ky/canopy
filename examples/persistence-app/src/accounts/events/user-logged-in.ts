import { Event } from '@doxajs/core'

export class UserLoggedIn extends Event<{ identityId: string; sessionId: string }> {
  static override readonly id = 'user-logged-in'
}

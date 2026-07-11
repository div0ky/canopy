import { Event } from '@canopy/core'

export class UserRegistered extends Event<{ identityId: string }> {
  static override readonly id = 'user-registered'
}

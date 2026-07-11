import { Event } from '@canopy/core'

export class HttpPinged extends Event {
  static override readonly id = 'http-pinged'

  constructor(readonly message: string) {
    super()
  }
}

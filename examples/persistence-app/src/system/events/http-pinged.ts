import { Event } from '@doxajs/core'

export class HttpPinged extends Event<{ message: string }> {
  static override readonly id = 'http-pinged'
}

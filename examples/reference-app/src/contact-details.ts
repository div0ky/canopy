import { Query } from '@doxajs/core'

export class ContactDetails extends Query<void, string> {
  static readonly id = 'contact-details'
  static override readonly access = 'contact.read'

  handle(_input: void): string {
    return 'contact-details'
  }
}

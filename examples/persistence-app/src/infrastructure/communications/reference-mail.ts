import { FakeMailTransport } from '@doxajs/core'

export class ReferenceMail extends FakeMailTransport {
  static id = 'mail'
}

import { FakeBroadcastTransport } from '@doxajs/core'

export class ReferenceBroadcasting extends FakeBroadcastTransport {
  static readonly id = 'broadcasting'
}

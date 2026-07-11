import { Command, CurrentExecution } from '@doxajs/core'

import { commandLog } from '../../support/command-log.js'

export class DescribeDoxa extends Command {
  static override readonly id = 'describe-doxa'
  static override readonly name = 'doxa:describe'
  static override readonly description = 'Describe the running Doxa application.'
  static override readonly access = 'public'
  private readonly execution = this.inject(CurrentExecution)
  handle(arguments_: readonly string[]): void {
    commandLog.push({ arguments: [...arguments_], actor: this.execution.context.actor.kind })
  }
}

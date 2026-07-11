import { Command, CurrentExecution } from '@canopy/core'

import { commandLog } from '../../support/command-log.js'

export class DescribeCanopy extends Command {
  static override readonly id = 'describe-canopy'
  static override readonly name = 'canopy:describe'
  static override readonly description = 'Describe the running Canopy application.'
  static override readonly access = 'public'
  private readonly execution = this.inject(CurrentExecution)
  handle(arguments_: readonly string[]): void {
    commandLog.push({ arguments: [...arguments_], actor: this.execution.context.actor.kind })
  }
}

import { ActionBus, Command } from '@doxajs/core'

import { RenameCounter } from '../actions/rename-counter.js'

export class MarkCounterCommand extends Command {
  static override readonly id = 'mark-counter'
  static override readonly name = 'counter:mark'
  static override readonly description = 'Set a counter label through its mutating action.'
  static override readonly access = 'public'

  private readonly actions = this.inject(ActionBus)

  async handle(arguments_: readonly string[]): Promise<void> {
    const [id, label] = arguments_
    if (!id || !label) throw new Error('counter:mark requires a counter ID and label.')
    await this.actions.execute(RenameCounter, { id, label })
  }
}

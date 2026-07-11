import { DoxaRole } from './role.js'

export abstract class Command extends DoxaRole {
  static readonly id: string = ''
  static readonly name: string = ''
  static readonly description: string = ''
  static readonly access: string = ''
  abstract handle(arguments_: readonly string[]): void | Promise<void>
}

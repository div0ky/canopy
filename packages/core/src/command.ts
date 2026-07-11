export abstract class Command {
  static readonly id: string = ''
  static readonly name: string = ''
  static readonly description: string = ''
  static readonly access: string = ''
  abstract handle(arguments_: readonly string[]): void | Promise<void>
}

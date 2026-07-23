import {
  Command,
  Event,
  type HttpRequest,
  Job,
  Listener,
  Route,
  Schedule,
  Signal,
  SignalHandler,
} from '@doxajs/core'

export const authorizationEntrypointLog: string[] = []

export function resetAuthorizationEntrypointLog(): void {
  authorizationEntrypointLog.length = 0
}

export class AuthorizationModelSessionRoute extends Route {
  static override readonly id = 'authorization-model-session'
  static override readonly access = 'authorization.contact.read'
  readonly method = 'GET'
  readonly path = '/authorization/model-session'

  handle(_request: HttpRequest): object {
    authorizationEntrypointLog.push('route')
    return { authorized: true }
  }
}

export class AuthorizationModelSessionCommand extends Command {
  static override readonly id = 'authorization-model-session'
  static override readonly name = 'authorization:model-session'
  static override readonly description = 'Prove authorization model access for a command.'
  static override readonly access = 'authorization.contact.read'

  handle(_arguments: readonly string[]): void {
    authorizationEntrypointLog.push('command')
  }
}

export class AuthorizationModelSessionEvent extends Event {
  static override readonly id = 'authorization-model-session'
}

export class AuthorizationModelSessionListener extends Listener<AuthorizationModelSessionEvent> {
  static readonly id = 'authorization-model-session'
  static override readonly access = 'authorization.contact.read'

  handle(_event: AuthorizationModelSessionEvent): void {
    authorizationEntrypointLog.push('listener')
  }
}

export class AuthorizationModelSessionSignal extends Signal {
  static override readonly id = 'authorization-model-session'
}

export class AuthorizationModelSessionSignalHandler extends SignalHandler<AuthorizationModelSessionSignal> {
  static readonly id = 'authorization-model-session'
  static override readonly access = 'authorization.contact.read'

  handle(_signal: AuthorizationModelSessionSignal): void {
    authorizationEntrypointLog.push('signal')
  }
}

export class AuthorizationModelSessionScheduleJob extends Job<{ readonly source: string }> {
  static override readonly id = 'authorization-model-session-schedule'
  static override readonly access = 'public'

  handle(input: { readonly source: string }): void {
    authorizationEntrypointLog.push(input.source)
  }
}

export class AuthorizationModelSessionSchedule extends Schedule {
  static override readonly id = 'authorization-model-session'
  static override readonly access = 'authorization.contact.read'
  static override readonly job = AuthorizationModelSessionScheduleJob
  static override readonly everySeconds = 86_400
  static override readonly input = { source: 'schedule' }
}

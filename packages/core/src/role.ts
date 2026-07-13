import { Logger } from './logging.js'
import { currentRoleConstruction, type RoleInjectionToken } from './role-context.js'

export interface RoleInjector {
  <Value extends object>(token: RoleInjectionToken<Value>): Value
  optional<Value extends object>(token: RoleInjectionToken<Value>): Value | undefined
}

/** Shared execution-scoped behavior inherited by every framework-facing role. */
export abstract class DoxaRole {
  protected readonly logger: Logger
  protected readonly inject: RoleInjector

  constructor() {
    const construction = currentRoleConstruction()
    const owner = this.constructor as RoleInjectionToken
    this.logger =
      construction?.loggerFor?.(owner) ??
      construction?.logger ??
      new Logger({ channel: roleChannel(this.constructor.name) })
    const resolve = <Value extends object>(
      token: RoleInjectionToken<Value>,
      optional: boolean,
    ): Value | undefined => {
      if (!construction) {
        if (optional) return undefined
        throw new RoleInjectionError(
          `${this.constructor.name} uses this.inject() and must be constructed by a Doxa execution scope.`,
        )
      }
      return construction.resolve(token, optional, owner)
    }
    const inject = (<Value extends object>(token: RoleInjectionToken<Value>): Value => {
      const value = resolve(token, false)
      if (value === undefined) {
        throw new RoleInjectionError(
          `${this.constructor.name} has an unavailable required role dependency.`,
        )
      }
      return value
    }) as RoleInjector
    inject.optional = <Value extends object>(token: RoleInjectionToken<Value>): Value | undefined =>
      resolve(token, true)
    this.inject = inject
  }
}

export class RoleInjectionError extends Error {
  override readonly name = 'RoleInjectionError'
}

function roleChannel(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
}

import { AsyncLocalStorage } from 'node:async_hooks'

import type { Logger } from './logging.js'

export type RoleInjectionToken<Value = object> = abstract new (...arguments_: never[]) => Value

export interface RoleConstructionContext {
  readonly logger: Logger
  resolve<Value extends object>(
    token: RoleInjectionToken<Value>,
    optional: boolean,
  ): Value | undefined
}

const storage = new AsyncLocalStorage<RoleConstructionContext>()

export function currentRoleConstruction(): RoleConstructionContext | undefined {
  return storage.getStore()
}

export function runWithRoleConstruction<Output>(
  context: RoleConstructionContext,
  work: () => Output,
): Output {
  return storage.run(context, work)
}

import { AsyncLocalStorage } from 'node:async_hooks'

const modelSessions = new AsyncLocalStorage<unknown>()
const modelSessionStates = new WeakMap<object, () => CurrentModelSessionState>()

export function currentModelSession<Session>(): Session | undefined {
  return modelSessions.getStore() as Session | undefined
}

export interface CurrentModelSessionState {
  readonly active: boolean
  readonly readOnly: boolean
}

export function registerModelSessionState(
  session: object,
  state: () => CurrentModelSessionState,
): void {
  modelSessionStates.set(session, state)
}

export function currentModelSessionState(): CurrentModelSessionState | undefined {
  const session = modelSessions.getStore()
  if (typeof session !== 'object' || session === null) return undefined
  const state = modelSessionStates.get(session)?.()
  if (
    typeof state !== 'object' ||
    state === null ||
    !('active' in state) ||
    typeof state.active !== 'boolean' ||
    !('readOnly' in state) ||
    typeof state.readOnly !== 'boolean'
  ) {
    return undefined
  }
  return Object.freeze({ active: state.active, readOnly: state.readOnly })
}

export function runWithModelSession<Output>(
  session: unknown,
  work: () => Output | Promise<Output>,
): Output | Promise<Output> {
  return modelSessions.run(session, work)
}

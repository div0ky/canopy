import { AsyncLocalStorage } from 'node:async_hooks'

const modelSessions = new AsyncLocalStorage<unknown>()

export function currentModelSession<Session>(): Session | undefined {
  return modelSessions.getStore() as Session | undefined
}

export interface CurrentModelSessionState {
  readonly active: boolean
  readonly readOnly: boolean
}

export function currentModelSessionState(): CurrentModelSessionState | undefined {
  const session = modelSessions.getStore()
  if (
    typeof session !== 'object' ||
    session === null ||
    !('active' in session) ||
    typeof session.active !== 'boolean' ||
    !('readOnly' in session) ||
    typeof session.readOnly !== 'boolean'
  ) {
    return undefined
  }
  return Object.freeze({ active: session.active, readOnly: session.readOnly })
}

export function runWithModelSession<Output>(
  session: unknown,
  work: () => Output | Promise<Output>,
): Output | Promise<Output> {
  return modelSessions.run(session, work)
}

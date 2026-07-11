import { AsyncLocalStorage } from 'node:async_hooks'

const modelSessions = new AsyncLocalStorage<unknown>()

export function currentModelSession<Session>(): Session | undefined {
  return modelSessions.getStore() as Session | undefined
}

export function runWithModelSession<Output>(
  session: unknown,
  work: () => Output | Promise<Output>,
): Output | Promise<Output> {
  return modelSessions.run(session, work)
}

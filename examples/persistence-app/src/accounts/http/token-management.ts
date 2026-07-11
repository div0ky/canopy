import { CurrentExecution, HttpError } from '@doxajs/core'

export function requirePasswordSession(execution: CurrentExecution): string {
  const authentication = execution.context.authentication
  if (
    authentication.state !== 'authenticated' ||
    authentication.method !== 'password' ||
    !authentication.sessionId ||
    !authentication.identityId
  ) {
    throw new HttpError(
      403,
      'fresh_session_required',
      'A password-authenticated browser session is required.',
    )
  }
  return authentication.identityId
}

export function publicAccessToken(token: import('@doxajs/core').AuthAccessToken) {
  return {
    id: token.id,
    name: token.name,
    displayPrefix: token.displayPrefix,
    constraints: token.constraints,
    createdAt: token.createdAt.toISOString(),
    expiresAt: token.expiresAt.toISOString(),
    ...(token.lastUsedAt ? { lastUsedAt: token.lastUsedAt.toISOString() } : {}),
    ...(token.revokedAt ? { revokedAt: token.revokedAt.toISOString() } : {}),
  }
}

import { createHash } from 'node:crypto'

import { AuthenticationError, HttpError, type ResolvedHttpAuthentication } from '@doxajs/core'

export function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function normalizeOrigin(value: string): string {
  return new URL(value).origin
}

export function assertTrustedOrigin(
  request: Request,
  trustedOrigins: ReadonlySet<string>,
  force = false,
): void {
  if (!force && ['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return
  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new HttpError(
      403,
      'untrusted_origin',
      'Cross-site cookie-authenticated requests are forbidden.',
    )
  }
  const origin = request.headers.get('origin')
  let normalized: string | undefined
  try {
    normalized = origin ? normalizeOrigin(origin) : undefined
  } catch {
    normalized = undefined
  }
  if (!normalized || !trustedOrigins.has(normalized)) {
    throw new HttpError(
      403,
      'untrusted_origin',
      'Cookie-authenticated requests require a trusted Origin.',
    )
  }
}

export function cookieValue(header: string | null, name: string): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const separator = part.indexOf('=')
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue
    const value = part.slice(separator + 1).trim()
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined
  }
  return undefined
}

export function serializeCookie(
  name: string,
  value: string,
  options: { readonly maxAge?: number; readonly secure: boolean },
): string {
  return [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    ...(options.maxAge === undefined ? [] : [`Max-Age=${options.maxAge}`]),
    ...(options.secure ? ['Secure'] : []),
  ].join('; ')
}

export function anonymousAuthentication(): ResolvedHttpAuthentication {
  return Object.freeze({
    actor: Object.freeze({ kind: 'anonymous' as const }),
    authentication: Object.freeze({ state: 'anonymous' as const }),
  })
}

export function normalizeEmail(value: string): string {
  const email = normalizeEmailForLogin(value)
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AuthenticationError('invalid_registration', 'A valid email address is required.')
  }
  return email
}

export function normalizeEmailForLogin(value: string): string {
  return value.trim().normalize('NFC').toLowerCase()
}

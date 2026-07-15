export interface Identity {
  readonly id: string
  readonly identifier: string
  readonly identifierKind: 'email' | 'username' | 'custom'
  readonly contactEmail?: string
  readonly verification: 'verified' | 'unverified' | 'unsupported'
}

export interface CurrentIdentityResponse {
  readonly identity: Identity
  readonly authentication: {
    readonly method?: string
    readonly assurance?: string
    readonly sessionId?: string
    readonly credentialId?: string
    readonly constraints?: readonly string[]
  }
}

export interface AccessToken {
  readonly id: string
  readonly name: string
  readonly displayPrefix: string
  readonly constraints: readonly string[]
  readonly createdAt: string
  readonly expiresAt: string
}

export class DoxaClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'DoxaClientError'
  }
}

type DoxaEnvelope<Payload> =
  | { readonly ok: true; readonly data: Payload }
  | {
      readonly ok: false
      readonly code: string
      readonly message: string
      readonly data: null
      readonly details?: unknown
    }

export async function doxaRequest<Output>(path: string, init?: RequestInit): Promise<Output> {
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  const response = await fetch(`/api/doxa${path}`, {
    ...init,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
  })
  if (response.status === 204 || response.headers.get('content-length') === '0')
    return undefined as Output
  const body = (await response.json().catch(() => undefined)) as DoxaEnvelope<Output> | undefined
  if (!response.ok) {
    throw new DoxaClientError(
      response.status,
      body && !body.ok ? body.code : 'request_failed',
      body && !body.ok ? body.message : `Doxa returned HTTP ${response.status}.`,
    )
  }
  if (!body?.ok)
    throw new DoxaClientError(
      response.status,
      'invalid_response',
      'Doxa returned an invalid success envelope.',
    )
  return body.data
}

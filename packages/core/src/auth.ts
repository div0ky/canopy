import type {
  ActorRef,
  AuthenticationContext,
  ExecutionContext,
  PolicyDecision,
  SecretString,
} from './index.js'

export interface AuthIdentity {
  readonly id: string
  readonly email: string
  readonly emailVerified: boolean
  readonly createdAt: Date
}

export interface AuthSession {
  readonly id: string
  readonly identityId: string
  readonly createdAt: Date
  readonly authenticatedAt: Date
  readonly expiresAt: Date
  readonly lastSeenAt?: Date
  readonly revokedAt?: Date
}

export interface AuthSessionGrant {
  readonly identity: AuthIdentity
  readonly session: AuthSession
  readonly token: SecretString
}

export interface AuthAccessToken {
  readonly id: string
  readonly identityId: string
  readonly name: string
  readonly displayPrefix: string
  readonly constraints: readonly string[]
  readonly createdAt: Date
  readonly expiresAt: Date
  readonly lastUsedAt?: Date
  readonly revokedAt?: Date
}

export interface AuthAccessTokenGrant {
  readonly accessToken: AuthAccessToken
  readonly token: SecretString
}

export interface IssueAccessTokenInput {
  readonly name: string
  readonly constraints?: readonly string[]
  readonly expiresAt?: Date
}

export interface RegistrationInput {
  readonly email: string
  readonly password: string
}

export interface LoginInput {
  readonly email: string
  readonly password: string
}

export interface AuthChallengeGrant {
  readonly identityId: string
  readonly token: SecretString
  readonly expiresAt: Date
}

export interface AuthRequestMetadata {
  readonly ipAddress?: string
  readonly userAgent?: string
}

export interface ResolvedHttpAuthentication {
  readonly actor: ActorRef
  readonly authentication: AuthenticationContext
  readonly responseHeaders?: Readonly<Record<string, string>>
}

export interface AuthStorageDescription {
  readonly kind: 'canopy-owned' | 'mapped' | 'custom'
  readonly identities?: { readonly table: string; readonly ownership: 'canopy' | 'external' }
  readonly passwords?: { readonly table: string; readonly ownership: 'canopy' | 'external' }
  readonly sessions?: { readonly table: string; readonly ownership: 'canopy' | 'external' }
  readonly accessTokens?: { readonly table: string; readonly ownership: 'canopy' | 'external' }
  readonly challenges?: { readonly table: string; readonly ownership: 'canopy' | 'external' }
  readonly audit?: { readonly table: string; readonly ownership: 'canopy' | 'external' }
}

export class AuthenticationError extends Error {
  override readonly name = 'AuthenticationError'

  constructor(
    readonly code: 'ambiguous_credentials' | 'invalid_credentials' | 'email_taken' | 'invalid_registration' | 'invalid_token' | 'compromised_password',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

export class AuthenticationRateLimitError extends Error {
  override readonly name = 'AuthenticationRateLimitError'
  constructor(readonly retryAfterSeconds: number) { super('Too many authentication attempts. Try again later.') }
}

/** Canopy-owned identity and browser-session boundary. */
export abstract class Auth {
  storage(): AuthStorageDescription { return { kind: 'custom' } }
  abstract register(input: RegistrationInput): Promise<AuthIdentity>
  abstract findIdentity(identityId: string): Promise<AuthIdentity | undefined>
  abstract login(input: LoginInput, metadata?: AuthRequestMetadata): Promise<AuthSessionGrant>
  abstract issueEmailVerification(identityId: string): Promise<AuthChallengeGrant>
  abstract verifyEmail(token: string): Promise<AuthIdentity>
  abstract issuePasswordReset(email: string, metadata?: AuthRequestMetadata): Promise<AuthChallengeGrant | undefined>
  abstract resetPassword(token: string, newPassword: string): Promise<void>
  abstract changePassword(identityId: string, currentPassword: string, newPassword: string): Promise<void>
  abstract revokeSession(sessionId: string): Promise<void>
  abstract listSessions(identityId: string): Promise<readonly AuthSession[]>
  abstract revokeAllSessions(identityId: string): Promise<number>
  abstract issueAccessToken(identityId: string, input: IssueAccessTokenInput): Promise<AuthAccessTokenGrant>
  abstract listAccessTokens(identityId: string): Promise<readonly AuthAccessToken[]>
  abstract rotateAccessToken(identityId: string, tokenId: string): Promise<AuthAccessTokenGrant>
  abstract revokeAccessToken(identityId: string, tokenId: string): Promise<void>
  abstract recordAuthorization(
    ability: string,
    decision: PolicyDecision,
    context: ExecutionContext,
  ): Promise<void>
  abstract resolveHttp(request: Request): Promise<ResolvedHttpAuthentication>
  abstract sessionCookie(grant: AuthSessionGrant): string
  abstract expiredSessionCookie(): string
}

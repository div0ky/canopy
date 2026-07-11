import { randomBytes, randomUUID } from 'node:crypto'

import {
  Auth,
  type AuthAccessToken,
  type AuthAccessTokenGrant,
  type AuthStorageDescription,
  type AuthChallengeGrant,
  type AuthIdentity,
  type AuthRequestMetadata,
  type AuthSessionGrant,
  type AuthSession,
  AuthenticationError,
  AuthenticationRateLimitError,
  type Disposes,
  type LifecycleContext,
  type IssueAccessTokenInput,
  type LoginInput,
  type RegistrationInput,
  type ResolvedHttpAuthentication,
  type ExecutionContext,
  type PolicyDecision,
  SecretString,
  type Starts,
} from '@doxajs/core'
import { and, eq, gt, isNull, or } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool, type PoolClient, type QueryResultRow } from 'pg'

import {
  authAuditEvents,
  authChallenges,
  authRateLimits,
  authAccessTokens,
  authIdentities,
  authPasswords,
  authSchema,
  authSessions,
} from './schema.js'

import {
  quoteIdentifier,
  quoteQualified,
  validIdentifier,
  validQualifiedIdentifier,
} from './database-identifiers.js'
import {
  assertPassword,
  createPasswordRecord,
  decodePasswordRecord,
  dummyPasswordRecord,
  encodePasswordRecord,
  needsRehash,
  verifyPassword,
  type PasswordRecord,
} from './passwords.js'
import {
  anonymousAuthentication,
  assertTrustedOrigin,
  cookieValue,
  digest,
  normalizeEmail,
  normalizeEmailForLogin,
  normalizeOrigin,
  serializeCookie,
} from './request-auth.js'

const DEVELOPMENT_COOKIE_NAME = 'doxa_session'
const PRODUCTION_COOKIE_NAME = '__Host-doxa_session'

type Database = NodePgDatabase<typeof authSchema>

export interface PostgresAuthOptions {
  readonly connectionString: string
  readonly trustedOrigins: readonly string[]
  readonly secureCookies: boolean
  readonly absoluteSessionSeconds?: number
  readonly idleSessionSeconds?: number
  readonly applicationName?: string
  readonly passwordCompromised?: (password: string) => boolean | Promise<boolean>
  readonly challengeSeconds?: number
  readonly sessionRenewalSeconds?: number
  readonly sessionRotationGraceSeconds?: number
  readonly identityId?: () => string
  readonly tables?: {
    readonly identities: AuthIdentityTableMapping
    readonly passwords: AuthPasswordTableMapping
  }
}

export interface AuthIdentityTableMapping {
  readonly table: string
  readonly id: string
  readonly email: string
  readonly emailVerifiedAt: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface AuthPasswordTableMapping {
  readonly table: string
  readonly identityId: string
  /** One text column containing Doxa's versioned Argon2id record. */
  readonly password: string
  readonly updatedAt: string
}

type Queryable = Pick<Pool | PoolClient, 'query'>

export class PostgresAuth extends Auth implements Starts, Disposes {
  static readonly id = 'auth'

  #pool: Pool | undefined
  #database: Database | undefined
  #dummyPassword: PasswordRecord | undefined
  readonly #absoluteSessionSeconds: number
  readonly #idleSessionSeconds: number
  readonly #trustedOrigins: ReadonlySet<string>
  readonly #sessionRenewalSeconds: number
  readonly #sessionRotationGraceSeconds: number

  constructor(private readonly options: PostgresAuthOptions) {
    super()
    if (options.trustedOrigins.length === 0) {
      throw new Error('PostgresAuth requires at least one explicit trusted origin.')
    }
    this.#absoluteSessionSeconds = options.absoluteSessionSeconds ?? 60 * 60 * 24 * 30
    this.#idleSessionSeconds = options.idleSessionSeconds ?? 60 * 60 * 24 * 7
    this.#trustedOrigins = new Set(options.trustedOrigins.map(normalizeOrigin))
    this.#sessionRenewalSeconds = options.sessionRenewalSeconds ?? 15 * 60
    this.#sessionRotationGraceSeconds = options.sessionRotationGraceSeconds ?? 30
    if (options.tables) validateAuthMappings(options.tables)
  }

  override storage(): AuthStorageDescription {
    return Object.freeze({
      kind: this.options.tables ? 'mapped' : 'doxa-owned',
      identities: {
        table: this.options.tables?.identities.table ?? 'doxa_auth_identities',
        ownership: this.options.tables ? 'external' : 'doxa',
      },
      passwords: {
        table: this.options.tables?.passwords.table ?? 'doxa_auth_passwords',
        ownership: this.options.tables ? 'external' : 'doxa',
      },
      sessions: { table: 'doxa_auth_sessions', ownership: 'doxa' },
      accessTokens: { table: 'doxa_auth_access_tokens', ownership: 'doxa' },
      challenges: { table: 'doxa_auth_challenges', ownership: 'doxa' },
      audit: { table: 'doxa_auth_audit_events', ownership: 'doxa' },
    } satisfies AuthStorageDescription)
  }

  async start(context: LifecycleContext): Promise<void> {
    if (context.signal.aborted) throw context.signal.reason
    const pool = new Pool({
      connectionString: this.options.connectionString,
      application_name: this.options.applicationName ?? 'doxa-auth',
    })
    try {
      await pool.query('select 1')
      if (this.options.tables) await validateMappedAuthTables(pool, this.options.tables)
      this.#pool = pool
      this.#database = drizzle(pool, { schema: authSchema })
      this.#dummyPassword = await dummyPasswordRecord()
    } catch (error) {
      await pool.end().catch(() => undefined)
      throw error
    }
  }

  async dispose(_context: LifecycleContext): Promise<void> {
    const pool = this.#pool
    this.#pool = undefined
    this.#database = undefined
    this.#dummyPassword = undefined
    if (pool) await pool.end()
  }

  async register(input: RegistrationInput): Promise<AuthIdentity> {
    const database = this.#requireDatabase()
    const email = normalizeEmail(input.email)
    await this.#assertPassword(input.password)
    await this.#rateLimit('register', email, 5, 60 * 60, 60 * 60)
    const password = await createPasswordRecord(input.password)
    const id = this.options.identityId?.() ?? randomUUID()
    const now = new Date()
    try {
      if (this.options.tables) {
        await this.#mappedTransaction(async (transaction, client) => {
          await insertMappedRegistration(
            client,
            this.options.tables!,
            { id, email, emailVerifiedAt: null, createdAt: now, updatedAt: now },
            password,
          )
          await transaction.insert(authAuditEvents).values({
            id: randomUUID(),
            eventType: 'identity.registered',
            identityId: id,
            metadata: {},
            occurredAt: now,
          })
        })
        return Object.freeze({ id, email, emailVerified: false, createdAt: now })
      }
      await database.transaction(async (transaction) => {
        await transaction.insert(authIdentities).values({
          id,
          email,
          createdAt: now,
          updatedAt: now,
        })
        await transaction.insert(authPasswords).values({
          identityId: id,
          version: password.version,
          salt: password.salt,
          hash: password.hash,
          parameters: password.parameters,
          updatedAt: now,
        })
        await transaction.insert(authAuditEvents).values({
          id: randomUUID(),
          eventType: 'identity.registered',
          identityId: id,
          metadata: {},
          occurredAt: now,
        })
      })
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AuthenticationError(
          'email_taken',
          'Unable to create an account with the supplied details.',
        )
      }
      throw error
    }
    return Object.freeze({ id, email, emailVerified: false, createdAt: now })
  }

  async findIdentity(identityId: string): Promise<AuthIdentity | undefined> {
    if (this.options.tables)
      return await findMappedIdentity(
        this.#requirePool(),
        this.options.tables.identities,
        'id',
        identityId,
      )
    const [identity] = await this.#requireDatabase()
      .select()
      .from(authIdentities)
      .where(eq(authIdentities.id, identityId))
      .limit(1)
    return identity ? identityFrom(identity) : undefined
  }

  async login(input: LoginInput, metadata: AuthRequestMetadata = {}): Promise<AuthSessionGrant> {
    const database = this.#requireDatabase()
    const email = normalizeEmailForLogin(input.email)
    const bucket = `${email}\0${metadata.ipAddress ?? ''}`
    await this.#rateLimit('login', bucket, 5, 15 * 60, 15 * 60)
    const mappedRow = this.options.tables
      ? await findMappedLogin(this.#requirePool(), this.options.tables, email)
      : undefined
    const [defaultRow] = this.options.tables
      ? []
      : await database
          .select({
            identity: authIdentities,
            password: authPasswords,
          })
          .from(authIdentities)
          .innerJoin(authPasswords, eq(authPasswords.identityId, authIdentities.id))
          .where(eq(authIdentities.email, email))
          .limit(1)
    const row = mappedRow ?? defaultRow
    const candidate = row?.password ?? this.#dummyPassword
    if (!candidate) throw new Error('PostgresAuth is not started.')
    const valid = await verifyPassword(input.password, candidate)
    if (!row || !valid) {
      await this.#audit('authentication.failed', undefined, undefined, {
        emailDigest: digest(email),
      })
      throw new AuthenticationError(
        'invalid_credentials',
        'The supplied email or password is invalid.',
      )
    }
    await this.#clearRateLimit('login', bucket)

    if (needsRehash(row.password)) {
      const upgraded = await createPasswordRecord(input.password)
      if (this.options.tables)
        await updateMappedPassword(
          this.#requirePool(),
          this.options.tables.passwords,
          row.identity.id,
          upgraded,
          new Date(),
        )
      else
        await database
          .update(authPasswords)
          .set({
            version: upgraded.version,
            salt: upgraded.salt,
            hash: upgraded.hash,
            parameters: upgraded.parameters,
            updatedAt: new Date(),
          })
          .where(eq(authPasswords.identityId, row.identity.id))
    }

    const token = randomBytes(32).toString('base64url')
    const now = new Date()
    const session = Object.freeze({
      id: randomUUID(),
      identityId: row.identity.id,
      createdAt: now,
      authenticatedAt: now,
      expiresAt: new Date(now.getTime() + this.#absoluteSessionSeconds * 1_000),
    })
    await database.transaction(async (transaction) => {
      await transaction.insert(authSessions).values({
        ...session,
        tokenDigest: digest(token),
        lastSeenAt: now,
        idleExpiresAt: new Date(now.getTime() + this.#idleSessionSeconds * 1_000),
        ...(metadata.ipAddress ? { ipAddress: metadata.ipAddress.slice(0, 128) } : {}),
        ...(metadata.userAgent ? { userAgent: metadata.userAgent.slice(0, 512) } : {}),
      })
      await transaction.insert(authAuditEvents).values({
        id: randomUUID(),
        eventType: 'session.created',
        identityId: row.identity.id,
        sessionId: session.id,
        metadata: {},
        occurredAt: now,
      })
    })
    return Object.freeze({
      identity: identityFrom(row.identity),
      session,
      token: SecretString.from(token),
    })
  }

  async issueEmailVerification(identityId: string): Promise<AuthChallengeGrant> {
    const identity = await this.findIdentity(identityId)
    if (!identity)
      throw new AuthenticationError('invalid_credentials', 'Authentication is required.')
    return await this.#issueChallenge(identityId, 'email_verification')
  }

  async verifyEmail(token: string): Promise<AuthIdentity> {
    const now = new Date()
    const database = this.#requireDatabase()
    const verify = async (
      transaction: Database,
      updateIdentity: (identityId: string) => Promise<void>,
    ): Promise<string> => {
      const [challenge] = await transaction
        .update(authChallenges)
        .set({ consumedAt: now })
        .where(
          and(
            eq(authChallenges.tokenDigest, digest(token)),
            eq(authChallenges.purpose, 'email_verification'),
            isNull(authChallenges.consumedAt),
            gt(authChallenges.expiresAt, now),
          ),
        )
        .returning({ identityId: authChallenges.identityId })
      if (!challenge)
        throw new AuthenticationError(
          'invalid_token',
          'The verification token is invalid or expired.',
        )
      await updateIdentity(challenge.identityId)
      await transaction.insert(authAuditEvents).values({
        id: randomUUID(),
        eventType: 'identity.email_verified',
        identityId: challenge.identityId,
        metadata: {},
        occurredAt: now,
      })
      return challenge.identityId
    }
    const identityId = this.options.tables
      ? await this.#mappedTransaction((transaction, client) =>
          verify(transaction, (id) =>
            updateMappedIdentityVerification(client, this.options.tables!.identities, id, now),
          ),
        )
      : await database.transaction((transaction) =>
          verify(transaction as unknown as Database, (id) =>
            transaction
              .update(authIdentities)
              .set({ emailVerifiedAt: now, updatedAt: now })
              .where(eq(authIdentities.id, id))
              .then(() => undefined),
          ),
        )
    return (await this.findIdentity(identityId))!
  }

  async issuePasswordReset(
    emailInput: string,
    metadata: AuthRequestMetadata = {},
  ): Promise<AuthChallengeGrant | undefined> {
    const email = normalizeEmailForLogin(emailInput)
    await this.#rateLimit(
      'password_reset',
      `${email}\0${metadata.ipAddress ?? ''}`,
      3,
      60 * 60,
      60 * 60,
    )
    const identity = this.options.tables
      ? await findMappedIdentity(
          this.#requirePool(),
          this.options.tables.identities,
          'email',
          email,
        )
      : (
          await this.#requireDatabase()
            .select({
              id: authIdentities.id,
              email: authIdentities.email,
              emailVerifiedAt: authIdentities.emailVerifiedAt,
              createdAt: authIdentities.createdAt,
              updatedAt: authIdentities.updatedAt,
            })
            .from(authIdentities)
            .where(eq(authIdentities.email, email))
            .limit(1)
        )[0]
    return identity ? await this.#issueChallenge(identity.id, 'password_reset') : undefined
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    await this.#assertPassword(newPassword)
    const password = await createPasswordRecord(newPassword)
    const now = new Date()
    const reset = async (
      transaction: Database,
      updatePassword: (identityId: string) => Promise<void>,
    ): Promise<void> => {
      const [challenge] = await transaction
        .update(authChallenges)
        .set({ consumedAt: now })
        .where(
          and(
            eq(authChallenges.tokenDigest, digest(token)),
            eq(authChallenges.purpose, 'password_reset'),
            isNull(authChallenges.consumedAt),
            gt(authChallenges.expiresAt, now),
          ),
        )
        .returning({ identityId: authChallenges.identityId })
      if (!challenge)
        throw new AuthenticationError(
          'invalid_token',
          'The password reset token is invalid or expired.',
        )
      await updatePassword(challenge.identityId)
      await transaction
        .update(authSessions)
        .set({ revokedAt: now })
        .where(
          and(eq(authSessions.identityId, challenge.identityId), isNull(authSessions.revokedAt)),
        )
      await transaction.insert(authAuditEvents).values({
        id: randomUUID(),
        eventType: 'password.reset',
        identityId: challenge.identityId,
        metadata: {},
        occurredAt: now,
      })
    }
    if (this.options.tables) {
      await this.#mappedTransaction((transaction, client) =>
        reset(transaction, (id) =>
          updateMappedPassword(client, this.options.tables!.passwords, id, password, now),
        ),
      )
    } else {
      await this.#requireDatabase().transaction((transaction) =>
        reset(transaction as unknown as Database, (id) =>
          transaction
            .update(authPasswords)
            .set({ ...password, updatedAt: now })
            .where(eq(authPasswords.identityId, id))
            .then(() => undefined),
        ),
      )
    }
  }

  async changePassword(
    identityId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    await this.#assertPassword(newPassword)
    const current = this.options.tables
      ? await findMappedPassword(this.#requirePool(), this.options.tables.passwords, identityId)
      : (
          await this.#requireDatabase()
            .select()
            .from(authPasswords)
            .where(eq(authPasswords.identityId, identityId))
            .limit(1)
        )[0]
    if (!current || !(await verifyPassword(currentPassword, current)))
      throw new AuthenticationError('invalid_credentials', 'The current password is invalid.')
    const password = await createPasswordRecord(newPassword)
    const now = new Date()
    const change = async (
      transaction: Database,
      updatePassword: () => Promise<void>,
    ): Promise<void> => {
      await updatePassword()
      await transaction
        .update(authSessions)
        .set({ revokedAt: now })
        .where(and(eq(authSessions.identityId, identityId), isNull(authSessions.revokedAt)))
      await transaction.insert(authAuditEvents).values({
        id: randomUUID(),
        eventType: 'password.changed',
        identityId,
        metadata: {},
        occurredAt: now,
      })
    }
    if (this.options.tables)
      await this.#mappedTransaction((transaction, client) =>
        change(transaction, () =>
          updateMappedPassword(client, this.options.tables!.passwords, identityId, password, now),
        ),
      )
    else
      await this.#requireDatabase().transaction((transaction) =>
        change(transaction as unknown as Database, () =>
          transaction
            .update(authPasswords)
            .set({ ...password, updatedAt: now })
            .where(eq(authPasswords.identityId, identityId))
            .then(() => undefined),
        ),
      )
  }

  async revokeSession(sessionId: string): Promise<void> {
    const now = new Date()
    await this.#requireDatabase().transaction(async (transaction) => {
      const [session] = await transaction
        .update(authSessions)
        .set({
          revokedAt: now,
        })
        .where(and(eq(authSessions.id, sessionId), isNull(authSessions.revokedAt)))
        .returning({
          identityId: authSessions.identityId,
        })
      if (!session) return
      await transaction.insert(authAuditEvents).values({
        id: randomUUID(),
        eventType: 'session.revoked',
        identityId: session.identityId,
        sessionId,
        metadata: {},
        occurredAt: now,
      })
    })
  }

  async listSessions(identityId: string): Promise<readonly AuthSession[]> {
    const rows = await this.#requireDatabase()
      .select()
      .from(authSessions)
      .where(eq(authSessions.identityId, identityId))
    return rows.map((row) =>
      Object.freeze({
        id: row.id,
        identityId: row.identityId,
        createdAt: row.createdAt,
        authenticatedAt: row.authenticatedAt,
        expiresAt: row.expiresAt,
        lastSeenAt: row.lastSeenAt,
        ...(row.revokedAt ? { revokedAt: row.revokedAt } : {}),
      }),
    )
  }

  async revokeAllSessions(identityId: string): Promise<number> {
    const now = new Date()
    return await this.#requireDatabase().transaction(async (transaction) => {
      const sessions = await transaction
        .update(authSessions)
        .set({
          revokedAt: now,
        })
        .where(and(eq(authSessions.identityId, identityId), isNull(authSessions.revokedAt)))
        .returning({
          id: authSessions.id,
        })
      await transaction.insert(authAuditEvents).values({
        id: randomUUID(),
        eventType: 'sessions.revoked_all',
        identityId,
        metadata: { count: sessions.length },
        occurredAt: now,
      })
      return sessions.length
    })
  }

  async issueAccessToken(
    identityId: string,
    input: IssueAccessTokenInput,
  ): Promise<AuthAccessTokenGrant> {
    const identity = await this.findIdentity(identityId)
    if (!identity)
      throw new AuthenticationError('invalid_credentials', 'Authentication is required.')
    const material = accessTokenMaterial(identityId, input)
    await this.#requireDatabase().transaction(async (transaction) => {
      await transaction.insert(authAccessTokens).values(material.row)
      await transaction.insert(authAuditEvents).values({
        id: randomUUID(),
        eventType: 'access_token.issued',
        identityId,
        metadata: { tokenId: material.row.id },
        occurredAt: material.row.createdAt,
      })
    })
    return material.grant
  }

  async listAccessTokens(identityId: string): Promise<readonly AuthAccessToken[]> {
    const rows = await this.#requireDatabase()
      .select()
      .from(authAccessTokens)
      .where(eq(authAccessTokens.identityId, identityId))
    return rows.map(accessTokenFrom)
  }

  async rotateAccessToken(identityId: string, tokenId: string): Promise<AuthAccessTokenGrant> {
    const database = this.#requireDatabase()
    const [existing] = await database
      .select()
      .from(authAccessTokens)
      .where(
        and(
          eq(authAccessTokens.id, tokenId),
          eq(authAccessTokens.identityId, identityId),
          isNull(authAccessTokens.revokedAt),
        ),
      )
      .limit(1)
    if (!existing)
      throw new AuthenticationError('invalid_credentials', 'Access token is unavailable.')
    const material = accessTokenMaterial(identityId, {
      name: existing.name,
      constraints: existing.constraints,
      expiresAt: existing.expiresAt,
    })
    await database.transaction(async (transaction) => {
      await transaction
        .update(authAccessTokens)
        .set({ revokedAt: material.row.createdAt })
        .where(eq(authAccessTokens.id, existing.id))
      await transaction.insert(authAccessTokens).values(material.row)
      await transaction.insert(authAuditEvents).values({
        id: randomUUID(),
        eventType: 'access_token.rotated',
        identityId,
        metadata: { previousTokenId: existing.id, tokenId: material.row.id },
        occurredAt: material.row.createdAt,
      })
    })
    return material.grant
  }

  async revokeAccessToken(identityId: string, tokenId: string): Promise<void> {
    const now = new Date()
    await this.#requireDatabase().transaction(async (transaction) => {
      const [revoked] = await transaction
        .update(authAccessTokens)
        .set({ revokedAt: now })
        .where(
          and(
            eq(authAccessTokens.id, tokenId),
            eq(authAccessTokens.identityId, identityId),
            isNull(authAccessTokens.revokedAt),
          ),
        )
        .returning({ id: authAccessTokens.id })
      if (!revoked) return
      await transaction.insert(authAuditEvents).values({
        id: randomUUID(),
        eventType: 'access_token.revoked',
        identityId,
        metadata: { tokenId },
        occurredAt: now,
      })
    })
  }

  async recordAuthorization(
    ability: string,
    decision: PolicyDecision,
    context: ExecutionContext,
  ): Promise<void> {
    await this.#audit(
      'authorization.decided',
      context.authentication.identityId,
      uuidOrUndefined(context.authentication.sessionId),
      {
        ability,
        effect: decision.effect,
        policy: decision.policy,
        code: decision.code,
        actorKind: context.actor.kind,
        ...(context.actor.id ? { actorId: context.actor.id } : {}),
        executionId: context.executionId,
        correlationId: context.correlationId,
      },
    )
  }

  async resolveHttp(request: Request): Promise<ResolvedHttpAuthentication> {
    const cookieToken = cookieValue(request.headers.get('cookie'), this.#cookieName())
    const authorization = request.headers.get('authorization')
    if (cookieToken && authorization) {
      throw new AuthenticationError(
        'ambiguous_credentials',
        'Supply exactly one authentication method.',
      )
    }
    if (authorization) return await this.#resolveBearer(authorization)
    const token = cookieToken
    if (!token) return anonymousAuthentication()
    const now = new Date()
    const [session] = await this.#requireDatabase()
      .select()
      .from(authSessions)
      .where(
        and(
          or(
            eq(authSessions.tokenDigest, digest(token)),
            and(
              eq(authSessions.previousTokenDigest, digest(token)),
              gt(authSessions.previousTokenExpiresAt, now),
            ),
          ),
          isNull(authSessions.revokedAt),
          gt(authSessions.expiresAt, now),
          gt(authSessions.idleExpiresAt, now),
        ),
      )
      .limit(1)
    if (!session) return anonymousAuthentication()
    const identity = await this.findIdentity(session.identityId)
    if (!identity) return anonymousAuthentication()
    assertTrustedOrigin(request, this.#trustedOrigins)
    const currentDigest = digest(token)
    const matchedCurrent = session.tokenDigest === currentDigest
    const idleExpiresAt = new Date(
      Math.min(session.expiresAt.getTime(), now.getTime() + this.#idleSessionSeconds * 1_000),
    )
    let responseHeaders: Readonly<Record<string, string>> | undefined
    const renewalDue =
      matchedCurrent &&
      now.getTime() - session.lastSeenAt.getTime() >= this.#sessionRenewalSeconds * 1_000
    if (renewalDue) {
      const replacement = randomBytes(32).toString('base64url')
      const [rotated] = await this.#requireDatabase()
        .update(authSessions)
        .set({
          tokenDigest: digest(replacement),
          previousTokenDigest: session.tokenDigest,
          previousTokenExpiresAt: new Date(
            now.getTime() + this.#sessionRotationGraceSeconds * 1_000,
          ),
          lastSeenAt: now,
          idleExpiresAt,
        })
        .where(
          and(
            eq(authSessions.id, session.id),
            eq(authSessions.tokenDigest, session.tokenDigest),
            isNull(authSessions.revokedAt),
          ),
        )
        .returning({ id: authSessions.id })
      if (rotated)
        responseHeaders = Object.freeze({
          'set-cookie': serializeCookie(this.#cookieName(), replacement, {
            secure: this.options.secureCookies,
          }),
        })
    } else {
      await this.#requireDatabase()
        .update(authSessions)
        .set({ lastSeenAt: now, idleExpiresAt })
        .where(eq(authSessions.id, session.id))
    }
    return Object.freeze({
      actor: Object.freeze({ kind: 'user' as const, id: identity.id }),
      authentication: Object.freeze({
        state: 'authenticated' as const,
        identityId: identity.id,
        method: 'password',
        assurance: 'single-factor' as const,
        authenticatedAt: session.authenticatedAt,
        sessionId: session.id,
      }),
      ...(responseHeaders ? { responseHeaders } : {}),
    })
  }

  async #resolveBearer(authorization: string): Promise<ResolvedHttpAuthentication> {
    const match = /^Bearer (doxa_pat_([A-Za-z0-9_-]{16})_[A-Za-z0-9_-]{43})$/.exec(authorization)
    if (!match)
      throw new AuthenticationError('invalid_credentials', 'The bearer credential is invalid.')
    const [, token, tokenId] = match
    const now = new Date()
    const [accessToken] = await this.#requireDatabase()
      .select()
      .from(authAccessTokens)
      .where(
        and(
          eq(authAccessTokens.id, tokenId!),
          eq(authAccessTokens.tokenDigest, digest(token!)),
          isNull(authAccessTokens.revokedAt),
          gt(authAccessTokens.expiresAt, now),
        ),
      )
      .limit(1)
    if (!accessToken)
      throw new AuthenticationError('invalid_credentials', 'The bearer credential is invalid.')
    const identity = await this.findIdentity(accessToken.identityId)
    if (!identity)
      throw new AuthenticationError('invalid_credentials', 'The bearer credential is invalid.')
    await this.#requireDatabase()
      .update(authAccessTokens)
      .set({ lastUsedAt: now })
      .where(eq(authAccessTokens.id, accessToken.id))
    return Object.freeze({
      actor: Object.freeze({ kind: 'user' as const, id: identity.id }),
      authentication: Object.freeze({
        state: 'authenticated' as const,
        identityId: identity.id,
        method: 'bearer',
        assurance: 'single-factor' as const,
        authenticatedAt: now,
        credentialId: accessToken.id,
        constraints: Object.freeze([...accessToken.constraints]),
      }),
    })
  }

  sessionCookie(grant: AuthSessionGrant): string {
    return serializeCookie(this.#cookieName(), grant.token.reveal(), {
      secure: this.options.secureCookies,
    })
  }

  expiredSessionCookie(): string {
    return serializeCookie(this.#cookieName(), '', {
      maxAge: 0,
      secure: this.options.secureCookies,
    })
  }

  async #issueChallenge(
    identityId: string,
    purpose: 'email_verification' | 'password_reset',
  ): Promise<AuthChallengeGrant> {
    const token = randomBytes(32).toString('base64url')
    const now = new Date()
    const expiresAt = new Date(now.getTime() + (this.options.challengeSeconds ?? 60 * 60) * 1_000)
    await this.#requireDatabase().transaction(async (transaction) => {
      await transaction
        .update(authChallenges)
        .set({ consumedAt: now })
        .where(
          and(
            eq(authChallenges.identityId, identityId),
            eq(authChallenges.purpose, purpose),
            isNull(authChallenges.consumedAt),
          ),
        )
      await transaction.insert(authChallenges).values({
        id: randomUUID(),
        identityId,
        purpose,
        tokenDigest: digest(token),
        createdAt: now,
        expiresAt,
      })
      await transaction.insert(authAuditEvents).values({
        id: randomUUID(),
        eventType:
          purpose === 'email_verification'
            ? 'identity.verification_issued'
            : 'password.reset_issued',
        identityId,
        metadata: {},
        occurredAt: now,
      })
    })
    return Object.freeze({ identityId, token: SecretString.from(token), expiresAt })
  }

  async #assertPassword(password: string): Promise<void> {
    assertPassword(password)
    if (await this.options.passwordCompromised?.(password)) {
      throw new AuthenticationError(
        'compromised_password',
        'Choose a password that has not appeared in known breaches.',
      )
    }
  }

  async #rateLimit(
    action: string,
    value: string,
    limit: number,
    windowSeconds: number,
    blockSeconds: number,
  ): Promise<void> {
    const result = await this.#requirePool().query<{
      attempts: number
      blocked_until: Date | null
    }>(
      `
      INSERT INTO doxa_auth_rate_limits (action, bucket_key, window_started_at, attempts, blocked_until)
      VALUES ($1, $2, now(), 1, NULL)
      ON CONFLICT (action, bucket_key) DO UPDATE SET
        window_started_at = CASE WHEN doxa_auth_rate_limits.window_started_at <= now() - ($4 * interval '1 second') THEN now() ELSE doxa_auth_rate_limits.window_started_at END,
        attempts = CASE WHEN doxa_auth_rate_limits.window_started_at <= now() - ($4 * interval '1 second') THEN 1 ELSE doxa_auth_rate_limits.attempts + 1 END,
        blocked_until = CASE
          WHEN doxa_auth_rate_limits.blocked_until > now() THEN doxa_auth_rate_limits.blocked_until
          WHEN doxa_auth_rate_limits.window_started_at > now() - ($4 * interval '1 second') AND doxa_auth_rate_limits.attempts + 1 > $3 THEN now() + ($5 * interval '1 second')
          ELSE NULL
        END
      RETURNING attempts, blocked_until
    `,
      [action, digest(value), limit, windowSeconds, blockSeconds],
    )
    const blockedUntil = result.rows[0]?.blocked_until
    if (blockedUntil && blockedUntil.getTime() > Date.now()) {
      await this.#audit('authentication.rate_limited', undefined, undefined, { action })
      throw new AuthenticationRateLimitError(
        Math.max(1, Math.ceil((blockedUntil.getTime() - Date.now()) / 1_000)),
      )
    }
  }

  async #clearRateLimit(action: string, value: string): Promise<void> {
    await this.#requireDatabase()
      .delete(authRateLimits)
      .where(and(eq(authRateLimits.action, action), eq(authRateLimits.bucketKey, digest(value))))
  }

  #cookieName(): string {
    return this.options.secureCookies ? PRODUCTION_COOKIE_NAME : DEVELOPMENT_COOKIE_NAME
  }

  async #audit(
    eventType: string,
    identityId: string | undefined,
    sessionId: string | undefined,
    metadata: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    await this.#requireDatabase()
      .insert(authAuditEvents)
      .values({
        id: randomUUID(),
        eventType,
        ...(identityId ? { identityId } : {}),
        ...(sessionId ? { sessionId } : {}),
        metadata,
        occurredAt: new Date(),
      })
  }

  async #mappedTransaction<Output>(
    work: (database: Database, client: PoolClient) => Promise<Output>,
  ): Promise<Output> {
    const client = await this.#requirePool().connect()
    try {
      await client.query('BEGIN')
      const output = await work(drizzle(client, { schema: authSchema }), client)
      await client.query('COMMIT')
      return output
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  #requireDatabase(): Database {
    if (!this.#database) throw new Error('PostgresAuth is not started.')
    return this.#database
  }

  #requirePool(): Pool {
    if (!this.#pool) throw new Error('PostgresAuth is not started.')
    return this.#pool
  }
}

interface StoredIdentity {
  readonly id: string
  readonly email: string
  readonly emailVerifiedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

function validateAuthMappings(tables: NonNullable<PostgresAuthOptions['tables']>): void {
  for (const mapping of [tables.identities, tables.passwords]) {
    if (!validQualifiedIdentifier(mapping.table))
      throw new Error(`Invalid mapped auth table name ${mapping.table}.`)
    for (const [field, column] of Object.entries(mapping).filter(([field]) => field !== 'table')) {
      if (typeof column !== 'string' || !validIdentifier(column))
        throw new Error(`Invalid mapped auth column ${field}.`)
    }
  }
}

async function validateMappedAuthTables(
  queryable: Queryable,
  tables: NonNullable<PostgresAuthOptions['tables']>,
): Promise<void> {
  const identityColumns = Object.entries(tables.identities)
    .filter(([field]) => field !== 'table')
    .map(([, column]) => quoteIdentifier(column))
  const passwordColumns = Object.entries(tables.passwords)
    .filter(([field]) => field !== 'table')
    .map(([, column]) => quoteIdentifier(column))
  await queryable.query(
    `SELECT ${identityColumns.join(', ')} FROM ${quoteQualified(tables.identities.table)} LIMIT 0`,
  )
  await queryable.query(
    `SELECT ${passwordColumns.join(', ')} FROM ${quoteQualified(tables.passwords.table)} LIMIT 0`,
  )
}

async function insertMappedRegistration(
  queryable: Queryable,
  tables: NonNullable<PostgresAuthOptions['tables']>,
  identity: StoredIdentity,
  password: PasswordRecord,
): Promise<void> {
  const identityValues = new Map<string, unknown>([
    [tables.identities.id, identity.id],
    [tables.identities.email, identity.email],
    [tables.identities.emailVerifiedAt, identity.emailVerifiedAt],
    [tables.identities.createdAt, identity.createdAt],
    [tables.identities.updatedAt, identity.updatedAt],
  ])
  if (tables.identities.table === tables.passwords.table) {
    identityValues.set(tables.passwords.identityId, identity.id)
    identityValues.set(tables.passwords.password, encodePasswordRecord(password))
    identityValues.set(tables.passwords.updatedAt, identity.updatedAt)
    await insertMappedRow(queryable, tables.identities.table, identityValues)
    return
  }
  await insertMappedRow(queryable, tables.identities.table, identityValues)
  await insertMappedRow(
    queryable,
    tables.passwords.table,
    new Map<string, unknown>([
      [tables.passwords.identityId, identity.id],
      [tables.passwords.password, encodePasswordRecord(password)],
      [tables.passwords.updatedAt, identity.updatedAt],
    ]),
  )
}

async function insertMappedRow(
  queryable: Queryable,
  table: string,
  values: ReadonlyMap<string, unknown>,
): Promise<void> {
  const entries = [...values]
  const columns = entries.map(([column]) => quoteIdentifier(column)).join(', ')
  const placeholders = entries.map((_, index) => `$${index + 1}`).join(', ')
  await queryable.query(
    `INSERT INTO ${quoteQualified(table)} (${columns}) VALUES (${placeholders})`,
    entries.map(([, value]) => value),
  )
}

async function findMappedIdentity(
  queryable: Queryable,
  mapping: AuthIdentityTableMapping,
  by: 'id' | 'email',
  value: string,
): Promise<AuthIdentity | undefined> {
  const rows = await queryable.query<MappedIdentityRow>(
    `
    SELECT
      ${quoteIdentifier(mapping.id)}::text AS id,
      ${quoteIdentifier(mapping.email)} AS email,
      ${quoteIdentifier(mapping.emailVerifiedAt)} AS email_verified_at,
      ${quoteIdentifier(mapping.createdAt)} AS created_at,
      ${quoteIdentifier(mapping.updatedAt)} AS updated_at
    FROM ${quoteQualified(mapping.table)}
    WHERE ${quoteIdentifier(mapping[by])} = $1
    LIMIT 1
  `,
    [value],
  )
  const row = rows.rows[0]
  return row ? identityFrom(mappedIdentity(row)) : undefined
}

interface MappedIdentityRow extends QueryResultRow {
  readonly id: string
  readonly email: string
  readonly email_verified_at: Date | null
  readonly created_at: Date
  readonly updated_at: Date
}

function mappedIdentity(row: MappedIdentityRow): StoredIdentity {
  return {
    id: String(row.id),
    email: row.email,
    emailVerifiedAt: row.email_verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function findMappedLogin(
  queryable: Queryable,
  tables: NonNullable<PostgresAuthOptions['tables']>,
  email: string,
): Promise<{ identity: StoredIdentity; password: PasswordRecord } | undefined> {
  const identity = tables.identities
  const password = tables.passwords
  const rows = await queryable.query<MappedIdentityRow & { password_record: string }>(
    `
    SELECT
      i.${quoteIdentifier(identity.id)}::text AS id,
      i.${quoteIdentifier(identity.email)} AS email,
      i.${quoteIdentifier(identity.emailVerifiedAt)} AS email_verified_at,
      i.${quoteIdentifier(identity.createdAt)} AS created_at,
      i.${quoteIdentifier(identity.updatedAt)} AS updated_at,
      p.${quoteIdentifier(password.password)} AS password_record
    FROM ${quoteQualified(identity.table)} i
    INNER JOIN ${quoteQualified(password.table)} p
      ON p.${quoteIdentifier(password.identityId)}::text = i.${quoteIdentifier(identity.id)}::text
    WHERE i.${quoteIdentifier(identity.email)} = $1
    LIMIT 1
  `,
    [email],
  )
  const row = rows.rows[0]
  return row
    ? { identity: mappedIdentity(row), password: decodePasswordRecord(row.password_record) }
    : undefined
}

async function findMappedPassword(
  queryable: Queryable,
  mapping: AuthPasswordTableMapping,
  identityId: string,
): Promise<PasswordRecord | undefined> {
  const result = await queryable.query<{ password_record: string } & QueryResultRow>(
    `
    SELECT ${quoteIdentifier(mapping.password)} AS password_record
    FROM ${quoteQualified(mapping.table)}
    WHERE ${quoteIdentifier(mapping.identityId)}::text = $1
    LIMIT 1
  `,
    [identityId],
  )
  const encoded = result.rows[0]?.password_record
  return encoded ? decodePasswordRecord(encoded) : undefined
}

async function updateMappedPassword(
  queryable: Queryable,
  mapping: AuthPasswordTableMapping,
  identityId: string,
  password: PasswordRecord,
  now: Date,
): Promise<void> {
  const result = await queryable.query(
    `
    UPDATE ${quoteQualified(mapping.table)}
    SET ${quoteIdentifier(mapping.password)} = $1, ${quoteIdentifier(mapping.updatedAt)} = $2
    WHERE ${quoteIdentifier(mapping.identityId)}::text = $3
  `,
    [encodePasswordRecord(password), now, identityId],
  )
  if (result.rowCount !== 1)
    throw new AuthenticationError('invalid_credentials', 'Authentication is required.')
}

async function updateMappedIdentityVerification(
  queryable: Queryable,
  mapping: AuthIdentityTableMapping,
  identityId: string,
  now: Date,
): Promise<void> {
  const result = await queryable.query(
    `
    UPDATE ${quoteQualified(mapping.table)}
    SET ${quoteIdentifier(mapping.emailVerifiedAt)} = $1, ${quoteIdentifier(mapping.updatedAt)} = $1
    WHERE ${quoteIdentifier(mapping.id)}::text = $2
  `,
    [now, identityId],
  )
  if (result.rowCount !== 1)
    throw new AuthenticationError('invalid_credentials', 'Authentication is required.')
}

function identityFrom(row: typeof authIdentities.$inferSelect): AuthIdentity {
  return Object.freeze({
    id: row.id,
    email: row.email,
    emailVerified: row.emailVerifiedAt !== null,
    createdAt: row.createdAt,
  })
}

function accessTokenMaterial(
  identityId: string,
  input: IssueAccessTokenInput,
): {
  readonly row: typeof authAccessTokens.$inferInsert
  readonly grant: AuthAccessTokenGrant
} {
  const name = input.name.trim()
  if (name.length < 1 || name.length > 100) {
    throw new AuthenticationError(
      'invalid_registration',
      'Access token names must contain 1 to 100 characters.',
    )
  }
  const constraints = [...new Set(input.constraints ?? [])].sort()
  if (constraints.some((constraint) => !/^[a-z][a-z0-9._:-]{0,127}$/.test(constraint))) {
    throw new AuthenticationError(
      'invalid_registration',
      'Access token constraints contain an invalid value.',
    )
  }
  const createdAt = new Date()
  const expiresAt = input.expiresAt ?? new Date(createdAt.getTime() + 30 * 24 * 60 * 60 * 1_000)
  if (expiresAt.getTime() <= createdAt.getTime()) {
    throw new AuthenticationError(
      'invalid_registration',
      'Access token expiration must be in the future.',
    )
  }
  const id = randomBytes(12).toString('base64url')
  const secret = randomBytes(32).toString('base64url')
  const token = `doxa_pat_${id}_${secret}`
  const row = {
    id,
    identityId,
    name,
    displayPrefix: `doxa_pat_${id}_${secret.slice(0, 6)}`,
    tokenDigest: digest(token),
    constraints,
    createdAt,
    expiresAt,
  }
  return {
    row,
    grant: Object.freeze({
      accessToken: accessTokenFrom({
        ...row,
        lastUsedAt: null,
        revokedAt: null,
      }),
      token: SecretString.from(token),
    }),
  }
}

function accessTokenFrom(row: typeof authAccessTokens.$inferSelect): AuthAccessToken {
  return Object.freeze({
    id: row.id,
    identityId: row.identityId,
    name: row.name,
    displayPrefix: row.displayPrefix,
    constraints: Object.freeze([...row.constraints]),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    ...(row.lastUsedAt ? { lastUsedAt: row.lastUsedAt } : {}),
    ...(row.revokedAt ? { revokedAt: row.revokedAt } : {}),
  })
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  if ('code' in error && (error as { code?: unknown }).code === '23505') return true
  return 'cause' in error && isUniqueViolation((error as { cause?: unknown }).cause)
}

function uuidOrUndefined(value: string | undefined): string | undefined {
  return value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : undefined
}

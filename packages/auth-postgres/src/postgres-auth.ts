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
import type {
  CompiledAuthenticationConfiguration,
  CompiledCredentialReader,
} from './compiled-auth.js'

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
  verifyEncodedPassword,
  type PasswordRecord,
} from './passwords.js'
import {
  anonymousAuthentication,
  assertTrustedOrigin,
  cookieValue,
  digest,
  normalizeIdentifier,
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
  readonly contactEmail?: string
  readonly emailVerifiedAt?: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly identifierKind?: 'email' | 'username' | 'custom'
  readonly normalization?: CompiledAuthenticationConfiguration['identifier']['normalization']
  readonly verificationMode?: 'mapped' | 'sidecar' | 'trusted' | 'unsupported'
  readonly eligibility?: CompiledAuthenticationConfiguration['eligibility']
}

export interface AuthPasswordTableMapping {
  readonly table: string
  readonly identityId: string
  /** One text column containing Doxa's versioned Argon2id record. */
  readonly password: string
  readonly updatedAt: string
  readonly readers?: readonly CompiledCredentialReader[]
  readonly mode?: 'managed' | 'login-only'
  readonly ownership?: 'doxa' | 'external'
  readonly legacy?: {
    readonly table: string
    readonly identityId: string
    readonly password: string
    readonly readers: readonly CompiledCredentialReader[]
  }
}

type Queryable = Pick<Pool | PoolClient, 'query'>

export interface ManagedIdentityRegistrationRequest {
  readonly id: string
  readonly identifier: string
  readonly contactEmail?: string
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly persistAuthentication: (transaction: unknown, identityId: string) => Promise<void>
}

export interface CompiledAuthenticationRuntimeBinding {
  readonly registerManagedIdentity?: (
    request: ManagedIdentityRegistrationRequest,
  ) => Promise<string>
}

export class PostgresAuth extends Auth implements Starts, Disposes {
  static readonly id = 'auth'

  #pool: Pool | undefined
  #database: Database | undefined
  #dummyPassword: PasswordRecord | undefined
  #compiledAuthentication: CompiledAuthenticationConfiguration | undefined
  #compiledRuntime: CompiledAuthenticationRuntimeBinding | undefined
  #databaseGeneratedIdentityId = false
  #mappedTables: NonNullable<PostgresAuthOptions['tables']> | undefined
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
    this.#mappedTables = options.tables
  }

  bindCompiledAuthentication(
    configuration: CompiledAuthenticationConfiguration,
    runtime?: CompiledAuthenticationRuntimeBinding,
  ): void {
    if (this.#pool)
      throw new Error('PostgresAuth authentication mapping must be bound before start.')
    this.#compiledAuthentication = configuration
    this.#compiledRuntime = runtime
    if (configuration.source === 'doxa-owned') {
      this.#mappedTables = undefined
      return
    }
    const write = configuration.credentials.write
    this.#mappedTables = {
      identities: {
        table: configuration.table,
        id: configuration.columns.id,
        email: configuration.columns.identifier,
        ...(configuration.columns.contactEmail
          ? { contactEmail: configuration.columns.contactEmail }
          : {}),
        ...(configuration.verification.mode === 'mapped'
          ? { emailVerifiedAt: configuration.verification.column }
          : {}),
        createdAt: configuration.columns.createdAt,
        updatedAt: configuration.columns.updatedAt,
        identifierKind: configuration.identifier.kind,
        normalization: configuration.identifier.normalization,
        verificationMode: configuration.columns.contactEmail
          ? configuration.verification.mode
          : 'unsupported',
        eligibility: configuration.eligibility,
      },
      passwords:
        write.destination === 'sidecar'
          ? {
              table: 'doxa_auth_mapped_passwords',
              identityId: 'identity_id',
              password: 'password_record',
              updatedAt: 'updated_at',
              readers: configuration.credentials.readers,
              mode: configuration.mode === 'managed' ? 'managed' : 'login-only',
              ownership: 'doxa',
              legacy: {
                table: configuration.credentials.table,
                identityId: configuration.credentials.identityId,
                password: configuration.credentials.readers[0]!.hash,
                readers: configuration.credentials.readers,
              },
            }
          : {
              table: write.table,
              identityId: write.identityId,
              password: write.password,
              updatedAt: write.updatedAt ?? configuration.columns.updatedAt,
              readers: configuration.credentials.readers,
              mode: configuration.mode === 'managed' ? 'managed' : 'login-only',
              ownership: 'external',
              ...(configuration.credentials.table !== write.table ||
              configuration.credentials.identityId !== write.identityId ||
              configuration.credentials.readers.some((reader) => reader.hash !== write.password)
                ? {
                    legacy: {
                      table: configuration.credentials.table,
                      identityId: configuration.credentials.identityId,
                      password: configuration.credentials.readers[0]!.hash,
                      readers: configuration.credentials.readers,
                    },
                  }
                : {}),
            },
    }
    validateAuthMappings(this.#mappedTables)
  }

  override storage(): AuthStorageDescription {
    const compiled = this.#compiledAuthentication
    return Object.freeze({
      kind: this.#mappedTables ? 'mapped' : 'doxa-owned',
      ...(compiled
        ? {
            mapping: {
              mode: compiled.mode,
              source: compiled.source,
              ...(compiled.modelId ? { modelId: compiled.modelId } : {}),
              identifier: {
                field: compiled.columns.identifier,
                kind: compiled.identifier.kind,
                normalization: compiled.identifier.normalization.preset,
              },
              ...(compiled.columns.contactEmail
                ? { contactEmail: compiled.columns.contactEmail }
                : {}),
              verification: compiled.verification.mode,
              eligibility: compiled.eligibility.map((predicate) => predicate.column),
              hashers: compiled.credentials.readers.map((reader) => reader.preset),
            },
          }
        : {}),
      identities: {
        table: this.#mappedTables?.identities.table ?? 'doxa_auth_identities',
        ownership: this.#mappedTables ? 'external' : 'doxa',
      },
      passwords: {
        table: this.#mappedTables?.passwords.table ?? 'doxa_auth_passwords',
        ownership:
          this.#mappedTables?.passwords.ownership ?? (this.#mappedTables ? 'external' : 'doxa'),
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
      if (this.#mappedTables) {
        this.#databaseGeneratedIdentityId = await validateMappedAuthTables(pool, this.#mappedTables)
      }
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
    this.#databaseGeneratedIdentityId = false
    if (pool) await pool.end()
  }

  async register(input: RegistrationInput): Promise<AuthIdentity> {
    const database = this.#requireDatabase()
    const email = normalizeIdentifier(input.identifier, this.#normalization(), true)
    const contactEmail = this.#mappedTables?.identities.contactEmail
      ? normalizeIdentifier(
          input.contactEmail ??
            (this.#mappedTables.identities.contactEmail === this.#mappedTables.identities.email
              ? email
              : ''),
          { preset: 'email' },
          true,
        )
      : email
    await this.#assertPassword(input.password)
    await this.#rateLimit('register', email, 5, 60 * 60, 60 * 60)
    const password = await createPasswordRecord(input.password)
    const id = this.#databaseGeneratedIdentityId
      ? `doxa-generated:${randomUUID()}`
      : (this.options.identityId?.() ?? randomUUID())
    const now = new Date()
    try {
      if (this.#mappedTables) {
        const tables = this.#mappedTables
        if (
          this.#compiledAuthentication?.source === 'model' &&
          this.#compiledAuthentication.mode === 'managed' &&
          this.#compiledRuntime?.registerManagedIdentity
        ) {
          const persistedId = await this.#compiledRuntime.registerManagedIdentity({
            id,
            identifier: email,
            ...(contactEmail ? { contactEmail } : {}),
            createdAt: now,
            updatedAt: now,
            persistAuthentication: async (participant, identityId) => {
              const queryable = participant as Queryable
              await updateMappedPassword(queryable, tables.passwords, identityId, password, now)
              await queryable.query(
                `INSERT INTO doxa_auth_audit_events
                 (id, event_type, identity_id, metadata, occurred_at)
                 VALUES ($1, 'identity.registered', $2, '{}'::jsonb, $3)`,
                [randomUUID(), identityId, now],
              )
            },
          })
          const identity = await findMappedIdentity(
            this.#requirePool(),
            tables.identities,
            'id',
            persistedId,
          )
          if (!identity) throw new Error('Managed auth registration did not persist its identity.')
          return identity
        }
        await this.#mappedTransaction(async (transaction, client) => {
          await insertMappedRegistration(
            client,
            tables,
            { id, email, contactEmail, emailVerifiedAt: null, createdAt: now, updatedAt: now },
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
        return identityFromStored(
          { id, email, contactEmail, emailVerifiedAt: null, createdAt: now, updatedAt: now },
          tables.identities,
        )
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
    return identityFromStored({ id, email, emailVerifiedAt: null, createdAt: now, updatedAt: now })
  }

  async findIdentity(identityId: string): Promise<AuthIdentity | undefined> {
    if (this.#mappedTables) {
      const identity = await findMappedIdentity(
        this.#requirePool(),
        this.#mappedTables.identities,
        'id',
        identityId,
      )
      if (identity && !(await this.#ensureEligible(identityId))) return undefined
      return identity
    }
    const [identity] = await this.#requireDatabase()
      .select()
      .from(authIdentities)
      .where(eq(authIdentities.id, identityId))
      .limit(1)
    return identity ? identityFrom(identity) : undefined
  }

  async login(input: LoginInput, metadata: AuthRequestMetadata = {}): Promise<AuthSessionGrant> {
    const database = this.#requireDatabase()
    const email = normalizeIdentifier(input.identifier, this.#normalization())
    const bucket = `${email}\0${metadata.ipAddress ?? ''}`
    await this.#rateLimit('login', bucket, 5, 15 * 60, 15 * 60)
    const mappedRow = this.#mappedTables
      ? await findMappedLogin(this.#requirePool(), this.#mappedTables, email)
      : undefined
    const [defaultRow] = this.#mappedTables
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
    const mappedVerification = isMappedPassword(candidate)
      ? await verifyEncodedPassword(input.password, candidate.encoded, candidate.readers)
      : undefined
    const weakLoginOnly = Boolean(
      mappedVerification?.weak && this.#mappedTables?.passwords.mode === 'login-only',
    )
    const valid = weakLoginOnly
      ? false
      : (mappedVerification?.valid ??
        (await verifyPassword(input.password, candidate as PasswordRecord)))
    if (!row || !valid) {
      await this.#audit('authentication.failed', undefined, undefined, {
        emailDigest: digest(email),
      })
      throw new AuthenticationError(
        'invalid_credentials',
        'The supplied identifier or password is invalid.',
      )
    }
    if (!(await this.#ensureEligible(row.identity.id))) {
      throw new AuthenticationError(
        'invalid_credentials',
        'The supplied identifier or password is invalid.',
      )
    }
    await this.#clearRateLimit('login', bucket)

    const shouldUpgrade = isMappedPassword(row.password)
      ? Boolean(
          mappedVerification?.needsUpgrade && this.#mappedTables?.passwords.mode === 'managed',
        )
      : needsRehash(row.password)
    if (shouldUpgrade) {
      const upgraded = await createPasswordRecord(input.password)
      if (this.#mappedTables)
        await updateMappedPassword(
          this.#requirePool(),
          this.#mappedTables.passwords,
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
      identity: identityFromStored(row.identity, this.#mappedTables?.identities),
      session,
      token: SecretString.from(token),
    })
  }

  async issueEmailVerification(identityId: string): Promise<AuthChallengeGrant> {
    const identity = await this.findIdentity(identityId)
    if (!identity?.contactEmail || identity.verification === 'unsupported') {
      throw new AuthenticationError('invalid_credentials', 'Email verification is unavailable.')
    }
    return await this.#issueChallenge(identityId, 'email_verification', identity.contactEmail)
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
        .returning({
          identityId: authChallenges.identityId,
          recipientDigest: authChallenges.recipientDigest,
        })
      if (!challenge)
        throw new AuthenticationError(
          'invalid_token',
          'The verification token is invalid or expired.',
        )
      await this.#assertChallengeRecipient(challenge.identityId, challenge.recipientDigest)
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
    const identityId = this.#mappedTables
      ? await this.#mappedTransaction((transaction, client) =>
          verify(transaction, (id) =>
            updateMappedIdentityVerification(client, this.#mappedTables!.identities, id, now),
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
    identifierInput: string,
    metadata: AuthRequestMetadata = {},
  ): Promise<AuthChallengeGrant | undefined> {
    const email = normalizeIdentifier(identifierInput, this.#normalization())
    await this.#rateLimit(
      'password_reset',
      `${email}\0${metadata.ipAddress ?? ''}`,
      3,
      60 * 60,
      60 * 60,
    )
    const identity = this.#mappedTables
      ? await findMappedIdentity(this.#requirePool(), this.#mappedTables.identities, 'email', email)
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
    const contactEmail = identity
      ? 'identifier' in identity
        ? identity.contactEmail
        : identity.email
      : undefined
    if (identity && !(await this.#ensureEligible(identity.id))) return undefined
    return identity && contactEmail
      ? await this.#issueChallenge(identity.id, 'password_reset', contactEmail)
      : undefined
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
        .returning({
          identityId: authChallenges.identityId,
          recipientDigest: authChallenges.recipientDigest,
        })
      if (!challenge)
        throw new AuthenticationError(
          'invalid_token',
          'The password reset token is invalid or expired.',
        )
      await this.#assertChallengeRecipient(challenge.identityId, challenge.recipientDigest)
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
    if (this.#mappedTables) {
      await this.#mappedTransaction((transaction, client) =>
        reset(transaction, (id) =>
          updateMappedPassword(client, this.#mappedTables!.passwords, id, password, now),
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
    if (!(await this.#ensureEligible(identityId))) {
      throw new AuthenticationError('invalid_credentials', 'Authentication is required.')
    }
    await this.#assertPassword(newPassword)
    const current = this.#mappedTables
      ? await findMappedPassword(this.#requirePool(), this.#mappedTables.passwords, identityId)
      : (
          await this.#requireDatabase()
            .select()
            .from(authPasswords)
            .where(eq(authPasswords.identityId, identityId))
            .limit(1)
        )[0]
    if (!current || !(await verifyPasswordCandidate(currentPassword, current)))
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
    if (this.#mappedTables)
      await this.#mappedTransaction((transaction, client) =>
        change(transaction, () =>
          updateMappedPassword(client, this.#mappedTables!.passwords, identityId, password, now),
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

  async reauthenticate(
    identityId: string,
    sessionId: string,
    password: string,
    metadata: AuthRequestMetadata = {},
  ): Promise<Date> {
    if (!(await this.#ensureEligible(identityId))) {
      throw new AuthenticationError('invalid_credentials', 'Authentication is required.')
    }
    await this.#rateLimit(
      'reauthenticate',
      `${identityId}\0${metadata.ipAddress ?? ''}`,
      5,
      15 * 60,
      15 * 60,
    )
    const record = this.#mappedTables
      ? await findMappedPassword(this.#requirePool(), this.#mappedTables.passwords, identityId)
      : (
          await this.#requireDatabase()
            .select()
            .from(authPasswords)
            .where(eq(authPasswords.identityId, identityId))
            .limit(1)
        )[0]
    if (!record || !(await verifyPasswordCandidate(password, record))) {
      await this.#audit('session.reauthentication_failed', identityId, sessionId, {})
      throw new AuthenticationError('invalid_credentials', 'The current password is invalid.')
    }
    const now = new Date()
    await this.#requireDatabase().transaction(async (transaction) => {
      const [session] = await transaction
        .update(authSessions)
        .set({ authenticatedAt: now, lastSeenAt: now })
        .where(
          and(
            eq(authSessions.id, sessionId),
            eq(authSessions.identityId, identityId),
            isNull(authSessions.revokedAt),
            gt(authSessions.expiresAt, now),
            gt(authSessions.idleExpiresAt, now),
          ),
        )
        .returning({ id: authSessions.id })
      if (!session) {
        throw new AuthenticationError('invalid_credentials', 'Authentication is required.')
      }
      await transaction.insert(authAuditEvents).values({
        id: randomUUID(),
        eventType: 'session.reauthenticated',
        identityId,
        sessionId,
        metadata: {},
        occurredAt: now,
      })
    })
    await this.#clearRateLimit('reauthenticate', `${identityId}\0${metadata.ipAddress ?? ''}`)
    return now
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
    if (!(await this.#ensureEligible(identityId))) {
      throw new AuthenticationError('invalid_credentials', 'Authentication is required.')
    }
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
    if (!(await this.#ensureEligible(identityId))) {
      throw new AuthenticationError('invalid_credentials', 'Authentication is required.')
    }
    const rows = await this.#requireDatabase()
      .select()
      .from(authAccessTokens)
      .where(eq(authAccessTokens.identityId, identityId))
    return rows.map(accessTokenFrom)
  }

  async rotateAccessToken(identityId: string, tokenId: string): Promise<AuthAccessTokenGrant> {
    if (!(await this.#ensureEligible(identityId))) {
      throw new AuthenticationError('invalid_credentials', 'Authentication is required.')
    }
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
    if (!(await this.#ensureEligible(identityId))) {
      throw new AuthenticationError('invalid_credentials', 'Authentication is required.')
    }
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
    const webSocketUpgrade = request.headers.get('upgrade')?.toLowerCase() === 'websocket'
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
    // A WebSocket handshake is a GET, but it establishes long-lived cookie authority and must
    // receive the same trusted-origin protection as an unsafe HTTP request.
    assertTrustedOrigin(request, this.#trustedOrigins, webSocketUpgrade)
    const currentDigest = digest(token)
    const matchedCurrent = session.tokenDigest === currentDigest
    const idleExpiresAt = new Date(
      Math.min(session.expiresAt.getTime(), now.getTime() + this.#idleSessionSeconds * 1_000),
    )
    let responseHeaders: Readonly<Record<string, string>> | undefined
    const renewalDue =
      !webSocketUpgrade &&
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
    contactEmail: string,
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
        recipientDigest: digest(contactEmail),
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

  async #assertChallengeRecipient(identityId: string, recipientDigest: string): Promise<void> {
    const identity = await this.findIdentity(identityId)
    if (!identity?.contactEmail || digest(identity.contactEmail) !== recipientDigest) {
      throw new AuthenticationError(
        'invalid_token',
        'The authentication token is invalid or expired.',
      )
    }
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

  async #ensureEligible(identityId: string): Promise<boolean> {
    const mapping = this.#mappedTables?.identities
    if (!mapping?.eligibility?.length) return true
    if (await mappedIdentityEligible(this.#requirePool(), mapping, identityId)) return true

    const now = new Date()
    await this.#requireDatabase().transaction(async (transaction) => {
      await transaction
        .update(authSessions)
        .set({ revokedAt: now })
        .where(and(eq(authSessions.identityId, identityId), isNull(authSessions.revokedAt)))
      await transaction
        .update(authAccessTokens)
        .set({ revokedAt: now })
        .where(and(eq(authAccessTokens.identityId, identityId), isNull(authAccessTokens.revokedAt)))
      await transaction.insert(authAuditEvents).values({
        id: randomUUID(),
        eventType: 'identity.ineligible',
        identityId,
        metadata: {},
        occurredAt: now,
      })
    })
    return false
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

  #normalization(): CompiledAuthenticationConfiguration['identifier']['normalization'] {
    return this.#compiledAuthentication?.identifier.normalization ?? { preset: 'email' }
  }
}

interface StoredIdentity {
  readonly id: string
  readonly email: string
  readonly contactEmail?: string
  readonly emailVerifiedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

function validateAuthMappings(tables: NonNullable<PostgresAuthOptions['tables']>): void {
  for (const mapping of [tables.identities, tables.passwords]) {
    if (!validQualifiedIdentifier(mapping.table))
      throw new Error(`Invalid mapped auth table name ${mapping.table}.`)
  }
  for (const [field, column] of [
    ['id', tables.identities.id],
    ['email', tables.identities.email],
    ['contactEmail', tables.identities.contactEmail],
    ['emailVerifiedAt', tables.identities.emailVerifiedAt],
    ['createdAt', tables.identities.createdAt],
    ['updatedAt', tables.identities.updatedAt],
    ['identityId', tables.passwords.identityId],
    ['password', tables.passwords.password],
    ['passwordUpdatedAt', tables.passwords.updatedAt],
  ] as const) {
    if (column !== undefined) {
      if (typeof column !== 'string' || !validIdentifier(column))
        throw new Error(`Invalid mapped auth column ${field}.`)
    }
  }
}

async function validateMappedAuthTables(
  queryable: Queryable,
  tables: NonNullable<PostgresAuthOptions['tables']>,
): Promise<boolean> {
  const identityColumns = [
    tables.identities.id,
    tables.identities.email,
    tables.identities.contactEmail,
    tables.identities.emailVerifiedAt,
    tables.identities.createdAt,
    tables.identities.updatedAt,
    ...(tables.identities.eligibility?.map((predicate) => predicate.column) ?? []),
  ]
    .filter((column): column is string => Boolean(column))
    .map(quoteIdentifier)
  const passwordColumns = [
    tables.passwords.identityId,
    tables.passwords.password,
    tables.passwords.updatedAt,
  ]
    .filter((column): column is string => Boolean(column))
    .map(quoteIdentifier)
  await queryable.query(
    `SELECT ${identityColumns.join(', ')} FROM ${quoteQualified(tables.identities.table)} LIMIT 0`,
  )
  await queryable.query(
    `SELECT ${passwordColumns.join(', ')} FROM ${quoteQualified(tables.passwords.table)} LIMIT 0`,
  )
  if (tables.passwords.legacy) {
    const legacyColumns = [
      tables.passwords.legacy.identityId,
      ...tables.passwords.legacy.readers.map((reader) => reader.hash),
    ]
      .filter((column): column is string => Boolean(column))
      .map(quoteIdentifier)
    await queryable.query(
      `SELECT ${legacyColumns.join(', ')} FROM ${quoteQualified(tables.passwords.legacy.table)} LIMIT 0`,
    )
  }

  const identityMetadata = await mappedColumnMetadata(queryable, tables.identities.table)
  const primaryKey = await mappedPrimaryKey(queryable, tables.identities.table)
  if (primaryKey.length !== 1 || primaryKey[0] !== tables.identities.id) {
    throw new Error(
      `Mapped auth identities require the configured single-column primary key; found ${primaryKey.join(', ') || 'none'}.`,
    )
  }
  assertMappedColumnType(identityMetadata, tables.identities.email, 'identifier', TEXT_TYPES)
  if (tables.identities.contactEmail) {
    assertMappedColumnType(
      identityMetadata,
      tables.identities.contactEmail,
      'contact email',
      TEXT_TYPES,
    )
  }
  assertMappedColumnType(
    identityMetadata,
    tables.identities.createdAt,
    'created timestamp',
    TIME_TYPES,
  )
  assertMappedColumnType(
    identityMetadata,
    tables.identities.updatedAt,
    'updated timestamp',
    TIME_TYPES,
  )
  if (tables.identities.emailVerifiedAt) {
    assertMappedColumnType(
      identityMetadata,
      tables.identities.emailVerifiedAt,
      'verification timestamp',
      TIME_TYPES,
    )
  }
  if (tables.passwords.mode === 'managed') {
    for (const column of [
      tables.identities.email,
      tables.identities.contactEmail,
      tables.identities.createdAt,
      tables.identities.updatedAt,
      tables.identities.emailVerifiedAt,
    ].filter((value): value is string => Boolean(value))) {
      const metadata = identityMetadata.get(column)
      if (!metadata || metadata.generated) {
        throw new Error(`Managed auth identity column ${column} must be writable.`)
      }
    }
    for (const timestamp of [tables.identities.createdAt, tables.identities.updatedAt]) {
      if (!identityMetadata.get(timestamp)?.notNull) {
        throw new Error(`Managed auth timestamp column ${timestamp} must be NOT NULL.`)
      }
    }
  }
  const passwordMetadata = await mappedColumnMetadata(queryable, tables.passwords.table)
  assertMappedColumnType(passwordMetadata, tables.passwords.password, 'credential', TEXT_TYPES)
  assertMappedColumnType(
    passwordMetadata,
    tables.passwords.updatedAt,
    'credential timestamp',
    TIME_TYPES,
  )
  if (
    tables.passwords.mode === 'managed' &&
    passwordMetadata.get(tables.passwords.password)?.generated
  ) {
    throw new Error(`Managed auth credential column ${tables.passwords.password} must be writable.`)
  }
  if (tables.passwords.legacy) {
    const legacyMetadata = await mappedColumnMetadata(queryable, tables.passwords.legacy.table)
    for (const reader of tables.passwords.legacy.readers) {
      assertMappedColumnType(legacyMetadata, reader.hash, 'credential reader', TEXT_TYPES)
    }
  }
  await assertIdentifierUnique(queryable, tables.identities, identityMetadata)
  await assertCredentialRowsUnique(queryable, tables.passwords)
  return identityMetadata.get(tables.identities.id)?.databaseGenerated === true
}

const TEXT_TYPES = new Set(['text', 'varchar', 'bpchar', 'citext'])
const TIME_TYPES = new Set(['timestamp', 'timestamptz'])

interface MappedColumnMetadata {
  readonly type: string
  readonly notNull: boolean
  readonly generated: boolean
  readonly databaseGenerated: boolean
}

async function mappedColumnMetadata(
  queryable: Queryable,
  table: string,
): Promise<ReadonlyMap<string, MappedColumnMetadata>> {
  const result = await queryable.query<
    {
      name: string
      type: string
      not_null: boolean
      generated: string
      identity: string
      has_default: boolean
    } & QueryResultRow
  >(
    `SELECT a.attname AS name, t.typname AS type, a.attnotnull AS not_null,
            a.attgenerated AS generated, a.attidentity AS identity, a.atthasdef AS has_default
     FROM pg_attribute a
     JOIN pg_type t ON t.oid = a.atttypid
     WHERE a.attrelid = to_regclass($1) AND a.attnum > 0 AND NOT a.attisdropped`,
    [table],
  )
  return new Map(
    result.rows.map((row) => [
      row.name,
      {
        type: row.type,
        notNull: row.not_null,
        generated: Boolean(row.generated),
        databaseGenerated: Boolean(row.identity) || row.has_default,
      },
    ]),
  )
}

async function mappedPrimaryKey(queryable: Queryable, table: string): Promise<readonly string[]> {
  const result = await queryable.query<{ column_name: string } & QueryResultRow>(
    `SELECT a.attname AS column_name
     FROM pg_index i
     JOIN pg_attribute a
       ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey::smallint[])
     WHERE i.indrelid = to_regclass($1) AND i.indisprimary
     ORDER BY array_position(i.indkey::smallint[], a.attnum)`,
    [table],
  )
  return result.rows.map((row) => row.column_name)
}

function assertMappedColumnType(
  metadata: ReadonlyMap<string, MappedColumnMetadata>,
  column: string,
  role: string,
  accepted: ReadonlySet<string>,
): void {
  const actual = metadata.get(column)
  if (!actual || !accepted.has(actual.type)) {
    throw new Error(`Mapped auth ${role} column ${column} has an incompatible PostgreSQL type.`)
  }
}

async function assertIdentifierUnique(
  queryable: Queryable,
  mapping: AuthIdentityTableMapping,
  metadata: ReadonlyMap<string, MappedColumnMetadata>,
): Promise<void> {
  const indexes = await queryable.query<{ definition: string } & QueryResultRow>(
    `SELECT pg_get_indexdef(indexrelid) AS definition
     FROM pg_index
     WHERE indrelid = to_regclass($1) AND indisunique AND indisvalid`,
    [mapping.table],
  )
  const normalization = mapping.normalization?.preset ?? 'email'
  const compatible = indexes.rows.some(({ definition }) => {
    const normalizedDefinition = definition.replaceAll('"', '').replace(/\s+/g, '').toLowerCase()
    const column = mapping.email.toLowerCase()
    const direct = normalizedDefinition.includes(`(${column})`)
    const lowered =
      normalizedDefinition.includes(`lower(${column})`) ||
      normalizedDefinition.includes(`lower((${column})::text)`)
    return normalization === 'exact'
      ? direct
      : metadata.get(mapping.email)?.type === 'citext'
        ? direct
        : lowered
  })
  if (!compatible) {
    throw new Error(
      normalization === 'exact'
        ? 'Exact auth identifiers require a direct unique index.'
        : 'Normalized auth identifiers require citext uniqueness or a unique lower(column) index.',
    )
  }
}

async function assertCredentialRowsUnique(
  queryable: Queryable,
  mapping: AuthPasswordTableMapping,
): Promise<void> {
  const sources = [
    { table: mapping.table, identityId: mapping.identityId },
    ...(mapping.legacy
      ? [{ table: mapping.legacy.table, identityId: mapping.legacy.identityId }]
      : []),
  ]
  for (const source of sources) {
    const result = await queryable.query(
      `SELECT 1 FROM ${quoteQualified(source.table)}
       GROUP BY ${quoteIdentifier(source.identityId)} HAVING count(*) > 1 LIMIT 1`,
    )
    if (result.rowCount) throw new Error('Mapped auth credentials contain duplicate identity rows.')
  }
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
    [tables.identities.createdAt, identity.createdAt],
    [tables.identities.updatedAt, identity.updatedAt],
  ])
  if (tables.identities.contactEmail)
    identityValues.set(tables.identities.contactEmail, identity.contactEmail ?? identity.email)
  if (tables.identities.emailVerifiedAt)
    identityValues.set(tables.identities.emailVerifiedAt, identity.emailVerifiedAt)
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
      i.${quoteIdentifier(mapping.id)}::text AS id,
      i.${quoteIdentifier(mapping.email)} AS email,
      ${mapping.contactEmail ? `i.${quoteIdentifier(mapping.contactEmail)} AS contact_email` : 'NULL::text AS contact_email'},
      ${verificationSelect(mapping, 'i')},
      ${verificationDigestSelect(mapping)},
      i.${quoteIdentifier(mapping.createdAt)} AS created_at,
      i.${quoteIdentifier(mapping.updatedAt)} AS updated_at
    FROM ${quoteQualified(mapping.table)} i
    ${verificationJoin(mapping, 'i')}
    WHERE i.${quoteIdentifier(mapping[by])} = $1
    LIMIT 1
  `,
    [value],
  )
  const row = rows.rows[0]
  return row ? identityFromStored(mappedIdentity(row), mapping) : undefined
}

async function mappedIdentityEligible(
  queryable: Queryable,
  mapping: AuthIdentityTableMapping,
  identityId: string,
): Promise<boolean> {
  const values: unknown[] = [identityId]
  const predicates = (mapping.eligibility ?? []).map((predicate) => {
    const column = `i.${quoteIdentifier(predicate.column)}`
    if ('null' in predicate) return `${column} IS NULL`
    if ('notNull' in predicate) return `${column} IS NOT NULL`
    if ('equals' in predicate) {
      values.push(predicate.equals)
      return `${column} IS NOT DISTINCT FROM $${values.length}`
    }
    if (predicate.in.length === 0) return 'FALSE'
    const alternatives = predicate.in.map((value) => {
      values.push(value)
      return `${column} IS NOT DISTINCT FROM $${values.length}`
    })
    return `(${alternatives.join(' OR ')})`
  })
  const result = await queryable.query<{ eligible: boolean } & QueryResultRow>(
    `SELECT EXISTS (
       SELECT 1
       FROM ${quoteQualified(mapping.table)} i
       WHERE i.${quoteIdentifier(mapping.id)}::text = $1
         ${predicates.length ? `AND ${predicates.join(' AND ')}` : ''}
     ) AS eligible`,
    values,
  )
  return result.rows[0]?.eligible === true
}

interface MappedIdentityRow extends QueryResultRow {
  readonly id: string
  readonly email: string
  readonly contact_email: string | null
  readonly email_verified_at: Date | null
  readonly verification_contact_digest: string | null
  readonly created_at: Date
  readonly updated_at: Date
}

function mappedIdentity(row: MappedIdentityRow): StoredIdentity {
  const contactEmail = row.contact_email ?? row.email
  return {
    id: String(row.id),
    email: row.email,
    ...(row.contact_email ? { contactEmail: row.contact_email } : {}),
    emailVerifiedAt:
      row.verification_contact_digest && row.verification_contact_digest !== digest(contactEmail)
        ? null
        : row.email_verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

interface MappedPasswordCredential {
  readonly encoded: string
  readonly readers: readonly CompiledCredentialReader[]
}

function isMappedPassword(
  value: PasswordRecord | MappedPasswordCredential,
): value is MappedPasswordCredential {
  return 'encoded' in value
}

async function verifyPasswordCandidate(
  password: string,
  candidate: PasswordRecord | MappedPasswordCredential,
): Promise<boolean> {
  return isMappedPassword(candidate)
    ? (await verifyEncodedPassword(password, candidate.encoded, candidate.readers)).valid
    : await verifyPassword(password, candidate)
}

async function findMappedLogin(
  queryable: Queryable,
  tables: NonNullable<PostgresAuthOptions['tables']>,
  email: string,
): Promise<{ identity: StoredIdentity; password: MappedPasswordCredential } | undefined> {
  const identity = tables.identities
  const password = tables.passwords
  const legacy = password.legacy
  const legacySelections = legacy
    ? [...new Set(legacy.readers.map((reader) => reader.hash))].map(
        (column, index) =>
          `lp.${quoteIdentifier(column)} AS ${quoteIdentifier(`legacy_password_record_${index}`)}`,
      )
    : []
  const rows = await queryable.query<MappedIdentityRow & { password_record: string | null }>(
    `
    SELECT
      i.${quoteIdentifier(identity.id)}::text AS id,
      i.${quoteIdentifier(identity.email)} AS email,
      ${identity.contactEmail ? `i.${quoteIdentifier(identity.contactEmail)} AS contact_email` : 'NULL::text AS contact_email'},
      ${verificationSelect(identity, 'i')},
      ${verificationDigestSelect(identity)},
      i.${quoteIdentifier(identity.createdAt)} AS created_at,
      i.${quoteIdentifier(identity.updatedAt)} AS updated_at,
      p.${quoteIdentifier(password.password)} AS password_record
      ${legacySelections.length ? `, ${legacySelections.join(', ')}` : ''}
    FROM ${quoteQualified(identity.table)} i
    ${verificationJoin(identity, 'i')}
    ${legacy ? 'LEFT' : 'INNER'} JOIN ${quoteQualified(password.table)} p
      ON p.${quoteIdentifier(password.identityId)}::text = i.${quoteIdentifier(identity.id)}::text
    ${legacy ? `LEFT JOIN ${quoteQualified(legacy.table)} lp ON lp.${quoteIdentifier(legacy.identityId)}::text = i.${quoteIdentifier(identity.id)}::text` : ''}
    WHERE i.${quoteIdentifier(identity.email)} = $1
    LIMIT 1
  `,
    [email],
  )
  const row = rows.rows[0]
  if (!row) return undefined
  const legacyColumns = legacy ? [...new Set(legacy.readers.map((reader) => reader.hash))] : []
  const legacyIndex = legacyColumns.findIndex(
    (_column, index) => typeof row[`legacy_password_record_${index}`] === 'string',
  )
  const encoded =
    row.password_record ??
    (legacyIndex >= 0 ? String(row[`legacy_password_record_${legacyIndex}`]) : undefined)
  if (!encoded) return undefined
  return {
    identity: mappedIdentity(row),
    password: {
      encoded,
      readers: row.password_record
        ? [{ preset: 'doxa-argon2id', hash: password.password }]
        : (legacy?.readers.filter((reader) => reader.hash === legacyColumns[legacyIndex]) ?? []),
    },
  }
}

async function findMappedPassword(
  queryable: Queryable,
  mapping: AuthPasswordTableMapping,
  identityId: string,
): Promise<MappedPasswordCredential | undefined> {
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
  if (encoded)
    return {
      encoded,
      readers: mapping.legacy
        ? [{ preset: 'doxa-argon2id', hash: mapping.password }]
        : (mapping.readers ?? [{ preset: 'doxa-argon2id', hash: mapping.password }]),
    }
  if (!mapping.legacy) return undefined
  const legacyColumns = [...new Set(mapping.legacy.readers.map((reader) => reader.hash))]
  const legacy = await queryable.query<QueryResultRow>(
    `SELECT ${legacyColumns
      .map(
        (column, index) =>
          `${quoteIdentifier(column)} AS ${quoteIdentifier(`password_record_${index}`)}`,
      )
      .join(', ')}
     FROM ${quoteQualified(mapping.legacy.table)}
     WHERE ${quoteIdentifier(mapping.legacy.identityId)}::text = $1
     LIMIT 1`,
    [identityId],
  )
  const legacyRow = legacy.rows[0]
  const legacyIndex = legacyColumns.findIndex(
    (_column, index) => typeof legacyRow?.[`password_record_${index}`] === 'string',
  )
  return legacyIndex >= 0
    ? {
        encoded: String(legacyRow![`password_record_${legacyIndex}`]),
        readers: mapping.legacy.readers.filter(
          (reader) => reader.hash === legacyColumns[legacyIndex],
        ),
      }
    : undefined
}

async function updateMappedPassword(
  queryable: Queryable,
  mapping: AuthPasswordTableMapping,
  identityId: string,
  password: PasswordRecord,
  now: Date,
): Promise<void> {
  if (mapping.legacy) {
    const encoded = encodePasswordRecord(password)
    const updated = await queryable.query(
      `UPDATE ${quoteQualified(mapping.table)}
       SET ${quoteIdentifier(mapping.password)} = $1,
           ${quoteIdentifier(mapping.updatedAt)} = $2
       WHERE ${quoteIdentifier(mapping.identityId)}::text = $3`,
      [encoded, now, identityId],
    )
    if (updated.rowCount === 0) {
      await queryable.query(
        `INSERT INTO ${quoteQualified(mapping.table)} (
           ${quoteIdentifier(mapping.identityId)},
           ${quoteIdentifier(mapping.password)},
           ${quoteIdentifier(mapping.updatedAt)}
         ) VALUES ($1, $2, $3)`,
        [identityId, encoded, now],
      )
    }
    return
  }
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
  if (mapping.verificationMode === 'trusted') return
  if (mapping.verificationMode === 'sidecar') {
    const result = await queryable.query<{ contact_email: string } & QueryResultRow>(
      `SELECT ${quoteIdentifier(mapping.contactEmail ?? mapping.email)} AS contact_email
       FROM ${quoteQualified(mapping.table)}
       WHERE ${quoteIdentifier(mapping.id)}::text = $1
       LIMIT 1`,
      [identityId],
    )
    const contactEmail = result.rows[0]?.contact_email
    if (!contactEmail)
      throw new AuthenticationError('invalid_credentials', 'Authentication is required.')
    await queryable.query(
      `INSERT INTO doxa_auth_mapped_verifications (
         identity_id, contact_email_digest, verified_at
       ) VALUES ($1, $2, $3)
       ON CONFLICT (identity_id) DO UPDATE SET
         contact_email_digest = EXCLUDED.contact_email_digest,
         verified_at = EXCLUDED.verified_at`,
      [identityId, digest(contactEmail), now],
    )
    return
  }
  if (!mapping.emailVerifiedAt) {
    throw new AuthenticationError('invalid_credentials', 'Email verification is unavailable.')
  }
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
  return identityFromStored(row)
}

function identityFromStored(row: StoredIdentity, mapping?: AuthIdentityTableMapping): AuthIdentity {
  const verificationMode = mapping?.verificationMode ?? 'mapped'
  return Object.freeze({
    id: row.id,
    identifier: row.email,
    identifierKind: mapping?.identifierKind ?? 'email',
    ...(!mapping
      ? { contactEmail: row.email }
      : mapping.contactEmail && (row.contactEmail ?? row.email)
        ? { contactEmail: row.contactEmail ?? row.email }
        : {}),
    verification:
      verificationMode === 'unsupported'
        ? 'unsupported'
        : verificationMode === 'trusted' || row.emailVerifiedAt !== null
          ? 'verified'
          : 'unverified',
    createdAt: row.createdAt,
  })
}

function verificationSelect(mapping: AuthIdentityTableMapping, alias?: string): string {
  if (mapping.verificationMode === 'trusted') return 'CURRENT_TIMESTAMP AS email_verified_at'
  if (mapping.verificationMode === 'sidecar') return 'av.verified_at AS email_verified_at'
  if (!mapping.emailVerifiedAt) return 'NULL::timestamptz AS email_verified_at'
  return `${alias ? `${alias}.` : ''}${quoteIdentifier(mapping.emailVerifiedAt)} AS email_verified_at`
}

function verificationDigestSelect(mapping: AuthIdentityTableMapping): string {
  return mapping.verificationMode === 'sidecar'
    ? 'av.contact_email_digest AS verification_contact_digest'
    : 'NULL::text AS verification_contact_digest'
}

function verificationJoin(mapping: AuthIdentityTableMapping, alias: string): string {
  return mapping.verificationMode === 'sidecar'
    ? `LEFT JOIN doxa_auth_mapped_verifications av ON av.identity_id = ${alias}.${quoteIdentifier(mapping.id)}::text`
    : ''
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

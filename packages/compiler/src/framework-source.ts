import ts from 'typescript'

import { DoxaCompilationError } from './errors.js'

export const supportedPluginPackages = [
  '@doxajs/sendgrid',
  '@doxajs/theoria',
  '@doxajs/twilio-sms',
] as const

export interface PreparedApplication {
  readonly applicationId: string
  readonly plugins: readonly string[]
  readonly source: string
}

export function prepareFrameworkSource(fileName: string, sourceText: string): PreparedApplication {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true)
  const diagnostics =
    (sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] })
      .parseDiagnostics ?? []
  if (diagnostics.length > 0) {
    throw new DoxaCompilationError(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (value) => value,
        getCurrentDirectory: () => '',
        getNewLine: () => '\n',
      }),
    )
  }
  const application = sourceFile.statements.find(
    (statement): statement is ts.ClassDeclaration =>
      ts.isClassDeclaration(statement) &&
      statement.name?.text === 'Application' &&
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ===
        true,
  )
  if (!application) {
    throw new DoxaCompilationError(`Expected exported Application class in ${fileName}.`)
  }
  const applicationId = requiredStringProperty(application, 'id')
  const plugins = stringArrayProperty(application, 'plugins')
  for (const plugin of plugins) {
    if (!(supportedPluginPackages as readonly string[]).includes(plugin)) {
      throw new DoxaCompilationError(
        `Unsupported Doxa plugin ${plugin}. Supported plugins: ${supportedPluginPackages.join(', ')}.`,
      )
    }
  }
  if (new Set(plugins).size !== plugins.length) {
    throw new DoxaCompilationError('Application plugins must be unique.')
  }

  const framework = objectProperty(application, 'framework')
  const database = framework ? nestedObject(framework, 'database') : undefined
  const auth = framework ? nestedObject(framework, 'auth') : undefined
  const queue = framework ? nestedObject(framework, 'queue') : undefined
  const localConcurrency = queue ? optionalPositiveNumber(queue, 'localConcurrency') : undefined
  const outboxPollingMilliseconds = queue
    ? optionalPositiveNumber(queue, 'outboxPollingMilliseconds')
    : undefined
  const configuration = {
    applicationName: database
      ? (optionalString(database, 'applicationName') ?? applicationId)
      : applicationId,
    secureCookies: auth ? (optionalBoolean(auth, 'secureCookies') ?? false) : false,
    trustedOrigins: auth
      ? (optionalStringArray(auth, 'trustedOrigins') ?? ['http://127.0.0.1:3000'])
      : ['http://127.0.0.1:3000'],
    ...(localConcurrency === undefined ? {} : { localConcurrency }),
    ...(outboxPollingMilliseconds === undefined ? {} : { outboxPollingMilliseconds }),
  }

  return {
    applicationId,
    plugins,
    source: renderFrameworkSource(applicationId, plugins, configuration),
  }
}

function renderFrameworkSource(
  applicationId: string,
  plugins: readonly string[],
  configuration: {
    readonly applicationName: string
    readonly secureCookies: boolean
    readonly trustedOrigins: readonly string[]
    readonly localConcurrency?: number
    readonly outboxPollingMilliseconds?: number
  },
): string {
  const sendgrid = plugins.includes('@doxajs/sendgrid')
  const twilio = plugins.includes('@doxajs/twilio-sms')
  const theoria = plugins.includes('@doxajs/theoria')
  const optionalImports = [
    ...(sendgrid ? ["import { SendGridMailTransport } from '@doxajs/sendgrid'"] : []),
    ...(twilio ? ["import { TwilioSmsTransport } from '@doxajs/twilio-sms'"] : []),
    ...(theoria ? ["import { PostgresTheoria } from '@doxajs/theoria'"] : []),
  ]
  const configs = ['DatabaseConfig', 'AuthConfig']
  const providers = ['Transactions', 'Queues', 'ApplicationAuth', 'ApplicationCache']
  const providerSources: string[] = []

  if (sendgrid) {
    configs.push('SendGridConfig')
    providers.push('ApplicationMail')
    providerSources.push(`export class SendGridConfig extends Configuration {
  declare apiKey: SecretString
}

export class ApplicationMail extends SendGridMailTransport {
  static id = 'mail'
  constructor(config: SendGridConfig) { super({ apiKey: config.apiKey.reveal() }) }
}`)
  } else {
    providers.push('ApplicationMail')
    providerSources.push(
      "export class ApplicationMail extends FakeMailTransport { static id = 'mail' }",
    )
  }
  if (twilio) {
    configs.push('TwilioSmsConfig')
    providers.push('ApplicationSms')
    providerSources.push(`export class TwilioSmsConfig extends Configuration {
  declare accountSid: string
  declare authToken: SecretString
  declare messagingServiceSid: string
  declare statusCallback: string
}

export class ApplicationSms extends TwilioSmsTransport {
  static id = 'sms'
  constructor(config: TwilioSmsConfig) {
    super({
      accountSid: config.accountSid,
      authToken: config.authToken.reveal(),
      messagingServiceSid: config.messagingServiceSid,
      statusCallback: config.statusCallback,
    })
  }
}`)
  } else {
    providers.push('ApplicationSms')
    providerSources.push(
      "export class ApplicationSms extends FakeSmsTransport { static id = 'sms' }",
    )
  }
  if (theoria) {
    providers.push('ApplicationTheoria')
    providerSources.push(`export class ApplicationTheoria extends PostgresTheoria {
  static override readonly id = 'theoria'
  constructor(config: DatabaseConfig) {
    super({ connectionString: config.connectionString.reveal() })
  }
}`)
  }

  const queueOptions = [
    `connectionString: config.connectionString.reveal()`,
    `applicationName: ${JSON.stringify(configuration.applicationName)}`,
    ...(configuration.localConcurrency === undefined
      ? []
      : [`localConcurrency: ${configuration.localConcurrency}`]),
    ...(configuration.outboxPollingMilliseconds === undefined
      ? []
      : [`outboxPollingMilliseconds: ${configuration.outboxPollingMilliseconds}`]),
  ].join(', ')

  return `// Generated by @doxajs/compiler. Do not edit.
import { randomUUID } from 'node:crypto'

import {
  Action,
  ActionBus,
  Auth,
  Authorization,
  Configuration,
  CurrentExecution,
  FakeMailTransport,
  FakeSmsTransport,
  Feature,
  Http,
  HttpError,
  type HttpRequest,
  Mailer,
  Policy,
  type PolicyDecision,
  type PolicyRequest,
  Route,
  SecretString,
  allow,
  deny,
  isRecentPasswordAuthentication,
} from '@doxajs/core'
import { PostgresAuth } from '@doxajs/auth-postgres'
import { PostgresCache, PostgresTransactionManager } from '@doxajs/postgres-drizzle'
import { PgBossQueueManager } from '@doxajs/queue-pg-boss'
${optionalImports.join('\n')}

export class DatabaseConfig extends Configuration {
  declare connectionString: SecretString
}

export class AuthConfig extends Configuration {
  secureCookies = ${configuration.secureCookies}
  trustedOrigins = ${JSON.stringify(configuration.trustedOrigins.join(','))}
}

export class Transactions extends PostgresTransactionManager {
  static id = 'transactions'
  constructor(config: DatabaseConfig) {
    super({ connectionString: config.connectionString.reveal(), applicationName: ${JSON.stringify(configuration.applicationName)} })
  }
}

export class Queues extends PgBossQueueManager {
  static id = 'queues'
  constructor(config: DatabaseConfig) { super({ ${queueOptions} }) }
}

export class ApplicationAuth extends PostgresAuth {
  static override readonly id = 'auth'
  constructor(database: DatabaseConfig, auth: AuthConfig) {
    super({
      connectionString: database.connectionString.reveal(),
      secureCookies: auth.secureCookies,
      trustedOrigins: auth.trustedOrigins.split(',').map((origin) => origin.trim()).filter(Boolean),
    })
  }
}

export class ApplicationCache extends PostgresCache {
  static id = 'cache'
  constructor(config: DatabaseConfig) {
    super({ connectionString: config.connectionString.reveal(), applicationName: ${JSON.stringify(`${configuration.applicationName}-cache`)} })
  }
}

${providerSources.join('\n\n')}

export class HealthRoute extends Route {
  static override readonly id = 'health'
  static override readonly access = 'public'
  readonly method = 'GET'
  readonly path = '/health'
  handle(_request: HttpRequest) { return { status: 'ok' } }
}

async function credentials(request: HttpRequest): Promise<{ email: string; password: string }> {
  const body = await request.json<{ email?: unknown; password?: unknown }>()
  if (typeof body.email !== 'string' || typeof body.password !== 'string') {
    throw new HttpError(422, 'validation_failed', 'email and password are required')
  }
  return { email: body.email, password: body.password }
}

export class SendAuthEmail extends Action<{ kind: 'verification' | 'password-reset'; to: string; token: string }, void> {
  static id = 'send-auth-email'
  static override readonly access = 'public'
  private readonly mailer = this.inject(Mailer)
  async handle(input: { kind: 'verification' | 'password-reset'; to: string; token: string }): Promise<void> {
    await this.mailer.send({
      id: randomUUID(),
      from: ${JSON.stringify(`accounts@${applicationId}.test`)},
      to: [input.to],
      subject: input.kind === 'verification' ? 'Verify your email' : 'Reset your password',
      text: input.token,
    })
  }
}

export class RegisterRoute extends Route {
  static override readonly id = 'register'
  static override readonly access = 'public'
  readonly method = 'POST'
  readonly path = '/auth/register'
  private readonly auth = this.inject(Auth)
  private readonly actions = this.inject(ActionBus)
  async handle(request: HttpRequest): Promise<Response> {
    const input = await credentials(request)
    const identity = await this.auth.register(input)
    const challenge = await this.auth.issueEmailVerification(identity.id)
    await this.actions.execute(SendAuthEmail, { kind: 'verification', to: identity.email, token: challenge.token.reveal() })
    return Http.created({ identity: { id: identity.id, email: identity.email, emailVerified: identity.emailVerified } })
  }
}

export class LoginRoute extends Route {
  static override readonly id = 'login'
  static override readonly access = 'public'
  readonly method = 'POST'
  readonly path = '/auth/login'
  private readonly auth = this.inject(Auth)
  async handle(request: HttpRequest): Promise<Response> {
    const grant = await this.auth.login(await credentials(request), { userAgent: request.header('user-agent') ?? 'unknown' })
    return Http.json(
      { identity: { id: grant.identity.id, email: grant.identity.email, emailVerified: grant.identity.emailVerified } },
      200,
      { 'set-cookie': this.auth.sessionCookie(grant) },
    )
  }
}

export class ReauthenticateRoute extends Route {
  static override readonly id = 'reauthenticate'
  static override readonly access = 'accounts.reauthenticate'
  readonly method = 'POST'
  readonly path = '/auth/reauthenticate'
  private readonly auth = this.inject(Auth)
  private readonly execution = this.inject(CurrentExecution)
  async handle(request: HttpRequest) {
    const authentication = this.execution.context.authentication
    const body = await request.json<{ password?: unknown }>()
    if (authentication.state !== 'authenticated' || authentication.method !== 'password' || !authentication.identityId || !authentication.sessionId) {
      throw new HttpError(403, 'password_session_required', 'A password-authenticated browser session is required.')
    }
    if (typeof body.password !== 'string') throw new HttpError(422, 'validation_failed', 'password is required')
    const authenticatedAt = await this.auth.reauthenticate(
      authentication.identityId,
      authentication.sessionId,
      body.password,
      { userAgent: request.header('user-agent') ?? 'unknown' },
    )
    return { authenticatedAt: authenticatedAt.toISOString() }
  }
}

export class MeRoute extends Route {
  static override readonly id = 'me'
  static override readonly access = 'accounts.view-self'
  readonly method = 'GET'
  readonly path = '/auth/me'
  private readonly execution = this.inject(CurrentExecution)
  handle(_request: HttpRequest) {
    return { actor: this.execution.context.actor, authentication: this.execution.context.authentication }
  }
}

export class VerifyEmailRoute extends Route {
  static override readonly id = 'verify-email'
  static override readonly access = 'public'
  readonly method = 'POST'
  readonly path = '/auth/email/verify'
  private readonly auth = this.inject(Auth)
  async handle(request: HttpRequest) {
    const body = await request.json<{ token?: unknown }>()
    if (typeof body.token !== 'string') throw new HttpError(422, 'validation_failed', 'token is required')
    const identity = await this.auth.verifyEmail(body.token)
    return { identity: { id: identity.id, email: identity.email, emailVerified: identity.emailVerified } }
  }
}

export class TokenRoute extends Route {
  static override readonly id = 'issue-token'
  static override readonly access = 'accounts.tokens.manage'
  readonly method = 'POST'
  readonly path = '/auth/tokens'
  private readonly auth = this.inject(Auth)
  private readonly execution = this.inject(CurrentExecution)
  async handle(request: HttpRequest): Promise<Response> {
    const identityId = this.execution.context.authentication.identityId
    if (!identityId) throw new HttpError(401, 'authentication_required', 'Authentication is required.')
    const body = await request.json<{ name?: unknown; constraints?: unknown }>()
    if (typeof body.name !== 'string' || (body.constraints !== undefined && (!Array.isArray(body.constraints) || !body.constraints.every((value) => typeof value === 'string')))) {
      throw new HttpError(422, 'validation_failed', 'name and string constraints are required')
    }
    const grant = await this.auth.issueAccessToken(identityId, {
      name: body.name,
      ...(body.constraints ? { constraints: body.constraints as string[] } : {}),
    })
    return Http.created({ accessToken: grant.accessToken, token: grant.token.reveal() })
  }
}

function requirePasswordSession(execution: CurrentExecution): string {
  const authentication = execution.context.authentication
  if (
    authentication.state !== 'authenticated' ||
    authentication.method !== 'password' ||
    !authentication.sessionId ||
    !authentication.identityId ||
    !isRecentPasswordAuthentication(authentication)
  ) {
    throw new HttpError(403, 'fresh_session_required', 'A recent password-authenticated browser session is required.')
  }
  return authentication.identityId
}

function publicAccessToken(token: import('@doxajs/core').AuthAccessToken) {
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

export class LogoutRoute extends Route {
  static override readonly id = 'logout'
  static override readonly access = 'accounts.logout'
  readonly method = 'POST'
  readonly path = '/auth/logout'
  private readonly auth = this.inject(Auth)
  private readonly execution = this.inject(CurrentExecution)
  async handle(_request: HttpRequest): Promise<Response> {
    const sessionId = this.execution.context.authentication.sessionId
    if (!sessionId) throw new HttpError(401, 'authentication_required', 'Authentication is required.')
    await this.auth.revokeSession(sessionId)
    return Http.noContent({ 'set-cookie': this.auth.expiredSessionCookie() })
  }
}

export class ListAccessTokensRoute extends Route {
  static override readonly id = 'list-access-tokens'
  static override readonly access = 'accounts.tokens.manage'
  readonly method = 'GET'
  readonly path = '/auth/tokens'
  private readonly auth = this.inject(Auth)
  private readonly execution = this.inject(CurrentExecution)
  async handle(_request: HttpRequest) {
    const identityId = requirePasswordSession(this.execution)
    return { accessTokens: (await this.auth.listAccessTokens(identityId)).map(publicAccessToken) }
  }
}

export class RotateAccessTokenRoute extends Route {
  static override readonly id = 'rotate-access-token'
  static override readonly access = 'accounts.tokens.manage'
  readonly method = 'POST'
  readonly path = '/auth/tokens/:id/rotate'
  private readonly auth = this.inject(Auth)
  private readonly execution = this.inject(CurrentExecution)
  async handle(request: HttpRequest) {
    const grant = await this.auth.rotateAccessToken(requirePasswordSession(this.execution), request.param('id'))
    return { accessToken: publicAccessToken(grant.accessToken), token: grant.token.reveal() }
  }
}

export class RevokeAccessTokenRoute extends Route {
  static override readonly id = 'revoke-access-token'
  static override readonly access = 'accounts.tokens.manage'
  readonly method = 'DELETE'
  readonly path = '/auth/tokens/:id'
  private readonly auth = this.inject(Auth)
  private readonly execution = this.inject(CurrentExecution)
  async handle(request: HttpRequest): Promise<Response> {
    await this.auth.revokeAccessToken(requirePasswordSession(this.execution), request.param('id'))
    return Http.noContent()
  }
}

export class ChangePasswordRoute extends Route {
  static override readonly id = 'change-password'
  static override readonly access = 'accounts.password.change'
  readonly method = 'POST'
  readonly path = '/auth/password'
  private readonly auth = this.inject(Auth)
  private readonly execution = this.inject(CurrentExecution)
  async handle(request: HttpRequest): Promise<Response> {
    const identityId = requirePasswordSession(this.execution)
    const body = await request.json<{ currentPassword?: unknown; newPassword?: unknown }>()
    if (typeof body.currentPassword !== 'string' || typeof body.newPassword !== 'string') {
      throw new HttpError(422, 'validation_failed', 'currentPassword and newPassword are required')
    }
    await this.auth.changePassword(identityId, body.currentPassword, body.newPassword)
    return Http.noContent({ 'set-cookie': this.auth.expiredSessionCookie() })
  }
}

export class ListSessionsRoute extends Route {
  static override readonly id = 'list-sessions'
  static override readonly access = 'accounts.sessions.manage'
  readonly method = 'GET'
  readonly path = '/auth/sessions'
  private readonly auth = this.inject(Auth)
  private readonly execution = this.inject(CurrentExecution)
  async handle(_request: HttpRequest) {
    const identityId = requirePasswordSession(this.execution)
    const sessions = await this.auth.listSessions(identityId)
    return { sessions: sessions.map((session) => ({
      id: session.id,
      createdAt: session.createdAt.toISOString(),
      lastSeenAt: session.lastSeenAt?.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      revokedAt: session.revokedAt?.toISOString(),
      current: session.id === this.execution.context.authentication.sessionId,
    })) }
  }
}

export class RevokeSessionRoute extends Route {
  static override readonly id = 'revoke-session'
  static override readonly access = 'accounts.sessions.manage'
  readonly method = 'DELETE'
  readonly path = '/auth/sessions/:id'
  private readonly auth = this.inject(Auth)
  private readonly execution = this.inject(CurrentExecution)
  async handle(request: HttpRequest): Promise<Response> {
    const identityId = requirePasswordSession(this.execution)
    const sessionId = request.param('id')
    const sessions = await this.auth.listSessions(identityId)
    if (sessions.some((session) => session.id === sessionId)) await this.auth.revokeSession(sessionId)
    return Http.noContent(
      sessionId === this.execution.context.authentication.sessionId
        ? { 'set-cookie': this.auth.expiredSessionCookie() }
        : undefined,
    )
  }
}

export class ResendVerificationRoute extends Route {
  static override readonly id = 'resend-verification'
  static override readonly access = 'accounts.email.verify'
  readonly method = 'POST'
  readonly path = '/auth/email/verification'
  private readonly auth = this.inject(Auth)
  private readonly actions = this.inject(ActionBus)
  private readonly execution = this.inject(CurrentExecution)
  async handle(_request: HttpRequest): Promise<Response> {
    const identityId = this.execution.context.authentication.identityId
    if (!identityId) throw new HttpError(401, 'authentication_required', 'Authentication is required.')
    const identity = await this.auth.findIdentity(identityId)
    if (identity && !identity.emailVerified) {
      const grant = await this.auth.issueEmailVerification(identity.id)
      await this.actions.execute(SendAuthEmail, { kind: 'verification', to: identity.email, token: grant.token.reveal() })
    }
    return Http.accepted(null)
  }
}

export class RequestPasswordResetRoute extends Route {
  static override readonly id = 'request-password-reset'
  static override readonly access = 'public'
  readonly method = 'POST'
  readonly path = '/auth/password/reset/request'
  private readonly auth = this.inject(Auth)
  private readonly actions = this.inject(ActionBus)
  async handle(request: HttpRequest): Promise<Response> {
    const body = await request.json<{ email?: unknown }>()
    if (typeof body.email === 'string') {
      const challenge = await this.auth.issuePasswordReset(body.email)
      if (challenge) await this.actions.execute(SendAuthEmail, { kind: 'password-reset', to: body.email, token: challenge.token.reveal() })
    }
    return new Response(null, { status: 202 })
  }
}

export class ResetPasswordRoute extends Route {
  static override readonly id = 'reset-password'
  static override readonly access = 'public'
  readonly method = 'POST'
  readonly path = '/auth/password/reset'
  private readonly auth = this.inject(Auth)
  async handle(request: HttpRequest): Promise<Response> {
    const body = await request.json<{ token?: unknown; password?: unknown }>()
    if (typeof body.token !== 'string' || typeof body.password !== 'string') {
      throw new HttpError(422, 'validation_failed', 'token and password are required')
    }
    await this.auth.resetPassword(body.token, body.password)
    return new Response(null, { status: 204 })
  }
}

export class AccountPolicy extends Policy {
  static override readonly id = 'account'
  static override readonly abilities = [
    'accounts.logout',
    'accounts.reauthenticate',
    'accounts.password.change',
    'accounts.email.verify',
    'accounts.sessions.manage',
    'accounts.tokens.manage',
    'accounts.view-self',
  ]
  decide(request: PolicyRequest): PolicyDecision {
    if (request.actor.kind !== 'user' || request.context.authentication.state !== 'authenticated') {
      return deny('account', 'authentication_required')
    }
    if (
      ['accounts.tokens.manage', 'accounts.sessions.manage', 'accounts.password.change'].includes(request.ability) &&
      !isRecentPasswordAuthentication(request.context.authentication)
    ) {
      return deny('account', 'fresh_session_required')
    }
    return allow('account')
  }
}

export class DoxaCoreFeature extends Feature {
  id = 'doxa'
  configs = [${configs.join(', ')}]
  providers = [${providers.join(', ')}]
  actions = [SendAuthEmail]
  routes = [HealthRoute, RegisterRoute, LoginRoute, LogoutRoute, ReauthenticateRoute, MeRoute, VerifyEmailRoute, ResendVerificationRoute, TokenRoute, ListAccessTokensRoute, RotateAccessTokenRoute, RevokeAccessTokenRoute, ChangePasswordRoute, ListSessionsRoute, RevokeSessionRoute, RequestPasswordResetRoute, ResetPasswordRoute]
  policies = [AccountPolicy]
}
`
}

function requiredStringProperty(declaration: ts.ClassDeclaration, name: string): string {
  const property = classProperty(declaration, name)
  if (
    !property?.initializer ||
    !ts.isStringLiteral(property.initializer) ||
    !property.initializer.text
  ) {
    throw new DoxaCompilationError(`Application.${name} must be a non-empty string literal.`)
  }
  return property.initializer.text
}

function stringArrayProperty(declaration: ts.ClassDeclaration, name: string): readonly string[] {
  const property = classProperty(declaration, name)
  if (!property) return []
  const initializer = property.initializer
    ? unwrapLiteralExpression(property.initializer)
    : undefined
  if (!initializer || !ts.isArrayLiteralExpression(initializer)) {
    throw new DoxaCompilationError(`Application.${name} must be a literal string array.`)
  }
  return initializer.elements.map((element) => {
    if (!ts.isStringLiteral(element)) {
      throw new DoxaCompilationError(`Application.${name} must contain string literals only.`)
    }
    return element.text
  })
}

function unwrapLiteralExpression(expression: ts.Expression): ts.Expression {
  let current = expression
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function objectProperty(
  declaration: ts.ClassDeclaration,
  name: string,
): ts.ObjectLiteralExpression | undefined {
  const property = classProperty(declaration, name)
  if (!property) return undefined
  if (!property.initializer || !ts.isObjectLiteralExpression(property.initializer)) {
    throw new DoxaCompilationError(`Application.${name} must be an object literal.`)
  }
  return property.initializer
}

function classProperty(
  declaration: ts.ClassDeclaration,
  name: string,
): ts.PropertyDeclaration | undefined {
  return declaration.members.find(
    (member): member is ts.PropertyDeclaration =>
      ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name) && member.name.text === name,
  )
}

function nestedObject(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.ObjectLiteralExpression | undefined {
  const property = objectPropertyAssignment(object, name)
  if (!property) return undefined
  if (!ts.isObjectLiteralExpression(property.initializer)) {
    throw new DoxaCompilationError(`Application.framework.${name} must be an object literal.`)
  }
  return property.initializer
}

function optionalString(object: ts.ObjectLiteralExpression, name: string): string | undefined {
  const property = objectPropertyAssignment(object, name)
  if (!property) return undefined
  if (!ts.isStringLiteral(property.initializer) || !property.initializer.text) {
    throw new DoxaCompilationError(`${name} must be a non-empty string literal.`)
  }
  return property.initializer.text
}

function optionalBoolean(object: ts.ObjectLiteralExpression, name: string): boolean | undefined {
  const property = objectPropertyAssignment(object, name)
  if (!property) return undefined
  if (property.initializer.kind === ts.SyntaxKind.TrueKeyword) return true
  if (property.initializer.kind === ts.SyntaxKind.FalseKeyword) return false
  throw new DoxaCompilationError(`${name} must be a boolean literal.`)
}

function optionalStringArray(
  object: ts.ObjectLiteralExpression,
  name: string,
): readonly string[] | undefined {
  const property = objectPropertyAssignment(object, name)
  if (!property) return undefined
  if (!ts.isArrayLiteralExpression(property.initializer)) {
    throw new DoxaCompilationError(`${name} must be a literal string array.`)
  }
  return property.initializer.elements.map((element) => {
    if (!ts.isStringLiteral(element) || !element.text) {
      throw new DoxaCompilationError(`${name} must contain non-empty string literals only.`)
    }
    return element.text
  })
}

function optionalPositiveNumber(
  object: ts.ObjectLiteralExpression,
  name: string,
): number | undefined {
  const property = objectPropertyAssignment(object, name)
  if (!property) return undefined
  if (!ts.isNumericLiteral(property.initializer)) {
    throw new DoxaCompilationError(`${name} must be a positive number literal.`)
  }
  const value = Number(property.initializer.text)
  if (!Number.isFinite(value) || value <= 0) {
    throw new DoxaCompilationError(`${name} must be a positive number literal.`)
  }
  return value
}

function objectPropertyAssignment(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  return object.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      ((ts.isIdentifier(property.name) && property.name.text === name) ||
        (ts.isStringLiteral(property.name) && property.name.text === name)),
  )
}

export {
  PostgresAuth,
  type AuthIdentityTableMapping,
  type AuthPasswordTableMapping,
  type PostgresAuthOptions,
} from './postgres-auth.js'
export {
  CANOPY_AUTH_MIGRATION_URL,
  CANOPY_AUTH_ACCESS_TOKEN_MIGRATION_URL,
  CANOPY_AUTH_CHALLENGE_MIGRATION_URL,
  CANOPY_AUTH_SESSION_ROTATION_MIGRATION_URL,
  CANOPY_AUTH_EXTERNAL_IDENTITIES_MIGRATION_URL,
  installAuthSchema,
} from './migration.js'
export {
  authAuditEvents,
  authChallenges,
  authRateLimits,
  authAccessTokens,
  authIdentities,
  authPasswords,
  authSchema,
  authSessions,
  type PasswordParameters,
} from './schema.js'

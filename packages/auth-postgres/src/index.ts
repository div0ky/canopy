export {
  PostgresAuth,
  type AuthIdentityTableMapping,
  type AuthPasswordTableMapping,
  type PostgresAuthOptions,
} from './postgres-auth.js'
export {
  DOXA_AUTH_MIGRATION_URL,
  DOXA_AUTH_ACCESS_TOKEN_MIGRATION_URL,
  DOXA_AUTH_CHALLENGE_MIGRATION_URL,
  DOXA_AUTH_SESSION_ROTATION_MIGRATION_URL,
  DOXA_AUTH_EXTERNAL_IDENTITIES_MIGRATION_URL,
  installAuthSchema,
} from './migration.js'

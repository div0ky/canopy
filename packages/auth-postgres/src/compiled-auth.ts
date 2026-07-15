export type CompiledAuthNormalization =
  | { readonly preset: 'exact' | 'lowercase' | 'email' }
  | { readonly preset: 'email-or-domain'; readonly domain: string }

export interface CompiledCredentialReader {
  readonly preset: 'doxa-argon2id' | 'bcrypt' | 'argon2id-phc' | 'sha256-hex'
  readonly hash: string
}

export type CompiledEligibilityPredicate =
  | { readonly column: string; readonly equals: string | number | boolean | null }
  | { readonly column: string; readonly in: readonly (string | number | boolean | null)[] }
  | { readonly column: string; readonly null: true }
  | { readonly column: string; readonly notNull: true }

export interface CompiledAuthenticationConfiguration {
  readonly mode: 'doxa-owned' | 'managed' | 'login-only'
  readonly source: 'doxa-owned' | 'model' | 'table'
  readonly modelId?: string
  readonly table: string
  readonly columns: {
    readonly id: string
    readonly identifier: string
    readonly contactEmail?: string
    readonly createdAt: string
    readonly updatedAt: string
  }
  readonly attributes?: {
    readonly identifier: string
    readonly contactEmail?: string
    readonly createdAt: string
    readonly updatedAt: string
    readonly verification?: string
  }
  readonly identifier: {
    readonly kind: 'email' | 'username' | 'custom'
    readonly normalization: CompiledAuthNormalization
  }
  readonly verification:
    | { readonly mode: 'mapped'; readonly column: string }
    | { readonly mode: 'sidecar' | 'trusted' | 'unsupported' }
  readonly eligibility: readonly CompiledEligibilityPredicate[]
  readonly credentials: {
    readonly table: string
    readonly identityId: string
    readonly readers: readonly CompiledCredentialReader[]
    readonly write:
      | { readonly destination: 'sidecar'; readonly format: 'doxa-argon2id' }
      | {
          readonly destination: 'in-place'
          readonly format: 'doxa-argon2id'
          readonly table: string
          readonly identityId: string
          readonly password: string
          readonly updatedAt?: string
        }
  }
  readonly registrationFactoryId?: string
  readonly routes: {
    readonly registration: boolean
    readonly verification: boolean
    readonly recovery: boolean
    readonly passwordChange: boolean
  }
}

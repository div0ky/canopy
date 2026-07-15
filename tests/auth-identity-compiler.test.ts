import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { compileApplication } from '@doxajs/compiler'
import { afterEach, describe, expect, it } from 'vitest'

const workspace = path.resolve(import.meta.dirname, '..')
const temporaryDirectories: string[] = []

describe('compiled authentication identity mappings', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    )
  })

  it('preserves Doxa-owned defaults when identity is absent', async () => {
    const result = await compileFixture(`
      import { DoxaApplication, Feature } from '@doxajs/core'
      class AppFeature extends Feature { id = 'app' }
      export class Application extends DoxaApplication {
        id = 'default-auth'
        features = [AppFeature]
      }
    `)

    expect(result.manifest.authentication).toEqual(
      expect.objectContaining({
        mode: 'doxa-owned',
        source: 'doxa-owned',
        identifier: { kind: 'email', normalization: { preset: 'email' } },
        routes: {
          registration: true,
          verification: true,
          recovery: true,
          passwordChange: true,
        },
      }),
    )
  })

  it('resolves logical model attributes into an immutable managed mapping', async () => {
    const result = await compileFixture(`
      import { DoxaApplication, Feature, Model, type ModelAttributes } from '@doxajs/core'
      interface UserAttributes extends ModelAttributes {
        id: string
        email: string
        active: boolean
        emailVerifiedAt: Date | null
        createdAt: Date
        updatedAt: Date
      }
      class User extends Model<UserAttributes> {
        static override readonly id = 'user'
        static override readonly table = 'legacy_users'
        static override readonly primaryKey = 'user_id'
        static override readonly columns = {
          id: 'user_id', email: 'email_address', active: 'enabled',
          emailVerifiedAt: 'verified_at', createdAt: 'created_at', updatedAt: 'updated_at',
        } as const
      }
      class UserRegistrationDefaults {
        defaults() { return { active: true } }
      }
      class AppFeature extends Feature { id = 'app'; models = [User] }
      export class Application extends DoxaApplication {
        id = 'managed-auth'
        features = [AppFeature]
        framework = { auth: { identity: {
          mode: 'managed', model: User,
          identifier: { kind: 'email', attribute: 'email', normalize: { preset: 'email' } },
          contactEmail: 'email',
          timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
          verification: { mode: 'mapped', attribute: 'emailVerifiedAt' },
          eligibility: [{ attribute: 'active', equals: true }],
          credentials: {
            table: 'legacy_users', identityId: 'user_id',
            readers: [{ preset: 'bcrypt', hash: 'password_hash' }],
            write: { format: 'doxa-argon2id', destination: 'sidecar' },
          },
          registrationFactory: UserRegistrationDefaults,
        } } } as const
      }
    `)

    expect(result.manifest.authentication).toEqual({
      mode: 'managed',
      source: 'model',
      modelId: 'model:app/user',
      table: 'legacy_users',
      columns: {
        id: 'user_id',
        identifier: 'email_address',
        contactEmail: 'email_address',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      attributes: {
        identifier: 'email',
        contactEmail: 'email',
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
        verification: 'emailVerifiedAt',
      },
      identifier: { kind: 'email', normalization: { preset: 'email' } },
      verification: { mode: 'mapped', column: 'verified_at' },
      eligibility: [{ column: 'enabled', equals: true }],
      credentials: {
        table: 'legacy_users',
        identityId: 'user_id',
        readers: [{ preset: 'bcrypt', hash: 'password_hash' }],
        write: { destination: 'sidecar', format: 'doxa-argon2id' },
      },
      registrationFactoryId: 'service:app/user-registration-defaults',
      routes: {
        registration: true,
        verification: true,
        recovery: true,
        passwordChange: true,
      },
    })
  })

  it('compiles the raw table escape hatch as login-only capabilities', async () => {
    const result = await compileFixture(`
      import { DoxaApplication, Feature } from '@doxajs/core'
      class AppFeature extends Feature { id = 'app' }
      export class Application extends DoxaApplication {
        id = 'raw-auth'
        features = [AppFeature]
        framework = { auth: { identity: {
          mode: 'login-only', table: 'employees',
          columns: {
            id: 'employee_id', identifier: 'username', contactEmail: 'email',
            createdAt: 'created_at', updatedAt: 'updated_at', verification: 'verified_at',
          },
          identifier: { kind: 'username', normalize: { preset: 'lowercase' } },
          verification: { mode: 'mapped' },
          eligibility: [{ column: 'active', equals: true }],
          credentials: {
            table: 'employees', identityId: 'employee_id',
            readers: [{ preset: 'sha256-hex', hash: 'password' }],
            write: { format: 'doxa-argon2id', destination: 'sidecar' },
          },
        } } } as const
      }
    `)

    expect(result.manifest.authentication).toEqual(
      expect.objectContaining({
        mode: 'login-only',
        source: 'table',
        table: 'employees',
        identifier: { kind: 'username', normalization: { preset: 'lowercase' } },
        routes: {
          registration: false,
          verification: false,
          recovery: false,
          passwordChange: false,
        },
      }),
    )
  })

  it('fails closed when a model mapping references an undeclared logical attribute', async () => {
    await expect(
      compileFixture(`
        import { DoxaApplication, Feature, Model, type ModelAttributes } from '@doxajs/core'
        interface UserAttributes extends ModelAttributes { id: string; createdAt: Date; updatedAt: Date }
        class User extends Model<UserAttributes> { static override readonly id = 'user'; static override readonly table = 'users' }
        class AppFeature extends Feature { id = 'app'; models = [User] }
        export class Application extends DoxaApplication {
          id = 'invalid-auth'; features = [AppFeature]
          framework = { auth: { identity: {
            mode: 'managed', model: User,
            identifier: { kind: 'email', attribute: 'missingEmail', normalize: { preset: 'email' } },
            timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
            verification: { mode: 'trusted' },
            credentials: {
              table: 'users', identityId: 'id', readers: [{ preset: 'bcrypt', hash: 'password' }],
              write: { format: 'doxa-argon2id', destination: 'sidecar' },
            },
          } } } as const
        }
      `),
    ).rejects.toThrow('Auth identity attribute missingEmail is not declared')
  })
})

async function compileFixture(source: string) {
  const root = await mkdtemp(path.join(workspace, '.auth-identity-fixture-'))
  temporaryDirectories.push(root)
  await mkdir(path.join(root, 'src'))
  await writeFile(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({
      extends: '../tsconfig.base.json',
      compilerOptions: {
        composite: false,
        rootDir: 'src',
        outDir: 'dist',
        declaration: false,
        declarationMap: false,
      },
      include: ['src/**/*.ts'],
    }),
  )
  await writeFile(path.join(root, 'src/application.ts'), source)
  return await compileApplication({
    tsconfigPath: path.join(root, 'tsconfig.json'),
    applicationFile: path.join(root, 'src/application.ts'),
    sourceRoot: path.join(root, 'src'),
    outputRoot: path.join(root, 'dist'),
    artifactsDirectory: path.join(root, '.doxa'),
  })
}

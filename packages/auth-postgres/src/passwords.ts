import { argon2, randomBytes, timingSafeEqual, type Argon2Parameters } from 'node:crypto'

import { AuthenticationError } from '@doxajs/core'

import type { PasswordParameters } from './schema.js'

const PASSWORD_VERSION = 1
const PASSWORD_PARAMETERS: PasswordParameters = Object.freeze({
  algorithm: 'argon2id',
  memory: 19_456,
  passes: 2,
  parallelism: 2,
  tagLength: 32,
})

export interface PasswordRecord {
  readonly version: number
  readonly salt: string
  readonly hash: string
  readonly parameters: PasswordParameters
}

let sharedDummyPassword: Promise<PasswordRecord> | undefined

export function dummyPasswordRecord(): Promise<PasswordRecord> {
  sharedDummyPassword ??= createPasswordRecord('doxa-dummy-password-never-valid')
  return sharedDummyPassword
}

export async function createPasswordRecord(password: string): Promise<PasswordRecord> {
  const salt = randomBytes(16)
  const hash = await derivePassword(password, salt, PASSWORD_PARAMETERS)
  return {
    version: PASSWORD_VERSION,
    salt: salt.toString('base64url'),
    hash: hash.toString('base64url'),
    parameters: PASSWORD_PARAMETERS,
  }
}

export async function verifyPassword(password: string, record: PasswordRecord): Promise<boolean> {
  try {
    const expected = Buffer.from(record.hash, 'base64url')
    const candidate = await derivePassword(
      password,
      Buffer.from(record.salt, 'base64url'),
      record.parameters,
    )
    return candidate.length === expected.length && timingSafeEqual(candidate, expected)
  } catch {
    return false
  }
}

export function needsRehash(record: PasswordRecord): boolean {
  return (
    record.version !== PASSWORD_VERSION ||
    JSON.stringify(record.parameters) !== JSON.stringify(PASSWORD_PARAMETERS)
  )
}

export function encodePasswordRecord(record: PasswordRecord): string {
  return `doxa-argon2id:${Buffer.from(JSON.stringify(record), 'utf8').toString('base64url')}`
}

export function decodePasswordRecord(value: string): PasswordRecord {
  try {
    if (!value.startsWith('doxa-argon2id:')) throw new Error('unsupported format')
    const parsed = JSON.parse(
      Buffer.from(value.slice('doxa-argon2id:'.length), 'base64url').toString('utf8'),
    ) as PasswordRecord
    if (
      parsed.version < 1 ||
      parsed.parameters.algorithm !== 'argon2id' ||
      !parsed.salt ||
      !parsed.hash
    )
      throw new Error('invalid record')
    return parsed
  } catch (error) {
    throw new AuthenticationError(
      'invalid_credentials',
      'The stored password format is not supported by this Doxa Auth mapping.',
      { cause: error },
    )
  }
}

export function assertPassword(password: string): void {
  const length = [...password].length
  if (length < 8 || length > 64) {
    throw new AuthenticationError(
      'invalid_registration',
      'Passwords must contain between 8 and 64 characters.',
    )
  }
}

function derivePassword(
  password: string,
  salt: Buffer,
  parameters: PasswordParameters,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const options: Argon2Parameters = {
      message: Buffer.from(password, 'utf8'),
      nonce: salt,
      parallelism: parameters.parallelism,
      tagLength: parameters.tagLength,
      memory: parameters.memory,
      passes: parameters.passes,
    }
    argon2('argon2id', options, (error, key) => (error ? reject(error) : resolve(key)))
  })
}

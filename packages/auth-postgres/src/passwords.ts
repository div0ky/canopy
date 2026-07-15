import {
  argon2,
  createHash,
  randomBytes,
  timingSafeEqual,
  type Argon2Parameters,
} from 'node:crypto'

import { AuthenticationError } from '@doxajs/core'
import { compare as compareBcrypt } from 'bcryptjs'

import type { PasswordParameters } from './schema.js'
import type { CompiledCredentialReader } from './compiled-auth.js'

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

export interface EncodedPasswordVerification {
  readonly valid: boolean
  readonly weak: boolean
  readonly needsUpgrade: boolean
}

export async function verifyEncodedPassword(
  password: string,
  encoded: string,
  readers: readonly CompiledCredentialReader[],
): Promise<EncodedPasswordVerification> {
  const presets = new Set(readers.map((reader) => reader.preset))
  if (encoded.startsWith('doxa-argon2id:') && presets.has('doxa-argon2id')) {
    try {
      const record = decodePasswordRecord(encoded)
      return {
        valid: await verifyPassword(password, record),
        weak: false,
        needsUpgrade: needsRehash(record),
      }
    } catch {
      return { valid: false, weak: false, needsUpgrade: false }
    }
  }
  if (/^\$2[aby]\$/.test(encoded) && presets.has('bcrypt')) {
    const cost = Number(encoded.slice(4, 6))
    if (!Number.isInteger(cost) || cost < 4 || cost > 16) {
      return { valid: false, weak: false, needsUpgrade: false }
    }
    return { valid: await compareBcrypt(password, encoded), weak: false, needsUpgrade: true }
  }
  if (encoded.startsWith('$argon2id$') && presets.has('argon2id-phc')) {
    return { valid: await verifyArgon2Phc(password, encoded), weak: false, needsUpgrade: true }
  }
  if (/^[0-9a-f]{64}$/.test(encoded) && presets.has('sha256-hex')) {
    const expected = Buffer.from(encoded, 'hex')
    const candidate = createHash('sha256').update(password).digest()
    return {
      valid: candidate.length === expected.length && timingSafeEqual(candidate, expected),
      weak: true,
      needsUpgrade: true,
    }
  }
  return { valid: false, weak: false, needsUpgrade: false }
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
      parsed.parameters.memory < 8 * parsed.parameters.parallelism ||
      parsed.parameters.memory > 262_144 ||
      parsed.parameters.passes < 1 ||
      parsed.parameters.passes > 10 ||
      parsed.parameters.parallelism < 1 ||
      parsed.parameters.parallelism > 8 ||
      parsed.parameters.tagLength < 16 ||
      parsed.parameters.tagLength > 64 ||
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

async function verifyArgon2Phc(password: string, encoded: string): Promise<boolean> {
  try {
    const match = encoded.match(
      /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/,
    )
    if (!match) return false
    const memory = Number(match[1])
    const passes = Number(match[2])
    const parallelism = Number(match[3])
    const salt = Buffer.from(match[4]!, 'base64')
    const expected = Buffer.from(match[5]!, 'base64')
    if (
      memory < 8 * parallelism ||
      memory > 262_144 ||
      passes < 1 ||
      passes > 10 ||
      parallelism < 1 ||
      parallelism > 8 ||
      salt.length < 8 ||
      expected.length < 16 ||
      expected.length > 64
    ) {
      return false
    }
    const candidate = await derivePassword(password, salt, {
      algorithm: 'argon2id',
      memory,
      passes,
      parallelism,
      tagLength: expected.length,
    })
    return candidate.length === expected.length && timingSafeEqual(candidate, expected)
  } catch {
    return false
  }
}

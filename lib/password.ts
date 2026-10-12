import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto'

// Stored as scrypt$N$r$p$salt$hash so the cost can be raised later without breaking old hashes.
const COST = { N: 2 ** 15, r: 8, p: 1 }
const KEY_LENGTH = 64

export const PASSWORD_MIN_LENGTH = 10

function scrypt(password: string, salt: Buffer, options: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password.normalize('NFKC'), salt, KEY_LENGTH, { ...options, maxmem: 128 * options.N! * options.r! * 2 }, (error, key) => (error ? reject(error) : resolve(key)))
  })
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, COST)
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64url'), key.toString('base64url')].join('$')
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, N, r, p, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64url')
  const actual = await scrypt(password, Buffer.from(salt, 'base64url'), { N: Number(N), r: Number(r), p: Number(p) })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

// Used when an email has no account, so a login takes as long whether or not the email exists.
let dummyHash: Promise<string> | undefined
export function dummyPasswordHash() {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'))
  return dummyHash
}

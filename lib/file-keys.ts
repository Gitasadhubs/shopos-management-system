// Object keys and their /api/files URLs. Kept apart from lib/storage.ts so code that only needs URLs
// (lib/local-platform.ts, which the proxy imports) does not pull in the S3 SDK.

export type FileKind = 'products' | 'payment-proofs'

const FILE_URL_PREFIX = '/api/files/'
// shops/<shop id>/<kind>/<uuid>.<ext> — the only shape the app writes or serves.
const KEY_PATTERN = /^shops\/([0-9a-f-]{36})\/(products|payment-proofs)\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/

export const fileUrl = (key: string) => `${FILE_URL_PREFIX}${key}`

export function parseFileKey(key: string) {
  const match = KEY_PATTERN.exec(key)
  return match ? { key, shopId: match[1], kind: match[2] as FileKind } : null
}

// The stored key behind a /api/files/... URL, or null for anything else (e.g. an external image link).
export const keyFromUrl = (url: string | null | undefined) => (url?.startsWith(FILE_URL_PREFIX) ? parseFileKey(url.slice(FILE_URL_PREFIX.length)) : null)

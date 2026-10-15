import { randomUUID } from 'node:crypto'
import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3'
import type { FileKind } from '@/lib/file-keys'
import { LocalDataError } from '@/lib/local-db'

// File storage (product photos, payment proofs) on any S3-compatible service: MinIO in the Docker
// stacks, or AWS S3 / Cloudflare R2 by changing SHOPOS_S3_*. The bucket stays private; browsers get
// files through /api/files/<key>, which checks who is asking (app/api/files/[...key]/route.ts).
// Import this only from route handlers: it loads the S3 SDK. Keys and URLs live in lib/file-keys.ts.

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

const store = globalThis as typeof globalThis & { shoposS3?: S3Client; shoposBucketReady?: Promise<void> }

const bucket = () => process.env.SHOPOS_S3_BUCKET || 'shopos'
export const storageConfigured = () => Boolean(process.env.SHOPOS_S3_ACCESS_KEY && process.env.SHOPOS_S3_SECRET_KEY)

function client() {
  if (!storageConfigured()) throw new LocalDataError('File storage is not set up on this server.', 503, 'storage_unavailable')
  store.shoposS3 ??= new S3Client({
    endpoint: process.env.SHOPOS_S3_ENDPOINT || undefined,
    region: process.env.SHOPOS_S3_REGION || 'us-east-1',
    // MinIO serves buckets as paths (http://minio:9000/<bucket>), not subdomains.
    forcePathStyle: process.env.SHOPOS_S3_PATH_STYLE !== 'false',
    credentials: { accessKeyId: process.env.SHOPOS_S3_ACCESS_KEY!, secretAccessKey: process.env.SHOPOS_S3_SECRET_KEY! },
  })
  return store.shoposS3
}

// Creates the bucket on first use, so a fresh MinIO needs no manual setup.
async function ready() {
  const s3 = client()
  store.shoposBucketReady ??= (async () => {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: bucket() }))
    } catch (error) {
      if (!(error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404)) throw error
      await s3.send(new CreateBucketCommand({ Bucket: bucket() }))
    }
  })().catch((error) => {
    store.shoposBucketReady = undefined
    throw error
  })
  await store.shoposBucketReady
  return s3
}

// The type comes from the file's first bytes, never from its name or the browser's claim.
const SIGNATURES: Array<{ type: string; ext: string; matches: (bytes: Uint8Array) => boolean }> = [
  { type: 'image/jpeg', ext: 'jpg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/png', ext: 'png', matches: (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => b[index] === value) },
  { type: 'image/webp', ext: 'webp', matches: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP' },
  { type: 'application/pdf', ext: 'pdf', matches: (b) => ascii(b, 0, 5) === '%PDF-' },
]
const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end))
const ALLOWED: Record<FileKind, string[]> = { products: ['image/jpeg', 'image/png', 'image/webp'], 'payment-proofs': ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] }
const ALLOWED_COPY: Record<FileKind, string> = { products: 'Choose a JPG, PNG or WebP photo.', 'payment-proofs': 'Choose a JPG, PNG or WebP screenshot, or a PDF.' }

export type Upload = { bytes: Uint8Array; type: string; ext: string; size: number }

// Reads the "file" field of a multipart request and checks its size and type.
export async function readUpload(request: Request, kind: FileKind): Promise<{ upload: Upload; form: FormData }> {
  const declared = Number(request.headers.get('content-length') ?? 0)
  // Multipart adds a little framing around the file itself.
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) throw new LocalDataError('The file is larger than 5 MB.', 413)
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    throw new LocalDataError('Send the file as a form upload.', 400)
  }
  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) throw new LocalDataError('Choose a file to upload.', 400)
  if (file.size > MAX_UPLOAD_BYTES) throw new LocalDataError('The file is larger than 5 MB.', 413)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const signature = SIGNATURES.find((item) => item.matches(bytes))
  if (!signature || !ALLOWED[kind].includes(signature.type)) throw new LocalDataError(ALLOWED_COPY[kind], 415)
  return { upload: { bytes, type: signature.type, ext: signature.ext, size: bytes.length }, form }
}

export async function saveFile(shopId: string, kind: FileKind, upload: Upload) {
  const key = `shops/${shopId}/${kind}/${randomUUID()}.${upload.ext}`
  const s3 = await ready()
  await s3.send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: upload.bytes, ContentType: upload.type, ContentLength: upload.size }))
  return key
}

export async function readFile(key: string) {
  const s3 = await ready()
  try {
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket(), Key: key }))
    return object.Body ? { body: object.Body.transformToWebStream(), type: object.ContentType ?? 'application/octet-stream', size: object.ContentLength } : null
  } catch (error) {
    if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) return null
    throw error
  }
}

// Best effort: a leftover file only costs space, so a failed delete never fails the request.
export async function deleteFile(key: string) {
  try {
    await (await ready()).send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }))
  } catch (error) {
    console.error('Could not delete stored file', key, error)
  }
}

export async function storageHealth() {
  if (!storageConfigured()) return 'off'
  // Short, so a stalled MinIO cannot make the app's own health check time out.
  await (await ready()).send(new HeadBucketCommand({ Bucket: bucket() }), { abortSignal: AbortSignal.timeout(2000) })
  return 'ok'
}

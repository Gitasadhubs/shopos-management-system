import { NextResponse } from 'next/server'
import { authorize, errorResponse, isSelfHosted, jsonResponse } from '@/lib/local-session'
import { can } from '@/lib/permissions'
import { parseFileKey } from '@/lib/file-keys'
import { readFile } from '@/lib/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Streams a stored file to someone allowed to see it: anyone in the shop for product photos, the
// owner for payment proofs, and platform admins for everything. Anything else is a plain 404.
export async function GET(request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  if (!isSelfHosted()) return jsonResponse(null, 'Not found.', 404)
  try {
    const auth = await authorize(request)
    if (auth instanceof NextResponse) return auth
    const file = parseFileKey((await params).key.join('/'))
    const { user } = auth
    const allowed = file && (user.role === 'admin' || (user.shop?.id === file.shopId && (file.kind === 'products' || can(user.role, 'billing'))))
    if (!file || !allowed) return jsonResponse(null, 'Not found.', 404)
    const stored = await readFile(file.key)
    if (!stored) return jsonResponse(null, 'Not found.', 404)
    const headers: Record<string, string> = {
      'Content-Type': stored.type,
      // Keys are never reused, so a file at a key never changes.
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
    }
    if (stored.size !== undefined) headers['Content-Length'] = String(stored.size)
    // Images opened directly can run nothing; PDFs need the browser's own viewer.
    if (stored.type.startsWith('image/')) headers['Content-Security-Policy'] = "default-src 'none'; sandbox"
    return new Response(stored.body, { headers })
  } catch (error) {
    return errorResponse(error, 'Unable to load the file.')
  }
}

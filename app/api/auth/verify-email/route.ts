import { NextResponse } from 'next/server'
import { z } from 'zod'
import { tokenField } from '@/lib/auth-schemas'
import { verifyEmail } from '@/lib/local-auth'
import { blockCrossOrigin, errorResponse, isSelfHosted, jsonResponse, parseBody } from '@/lib/local-session'

export const runtime = 'nodejs'

// POST, not GET, so email scanners that prefetch links cannot use up the token.
export async function POST(request: Request) {
  if (!isSelfHosted()) return jsonResponse(null, 'Not found.', 404)
  const blocked = await blockCrossOrigin(request)
  if (blocked) return blocked
  const body = await parseBody(request, z.object({ token: tokenField }))
  if (body instanceof NextResponse) return body
  try {
    const user = await verifyEmail(body.data.token)
    return jsonResponse({ email: user.email })
  } catch (error) {
    return errorResponse(error, 'Unable to confirm the email.')
  }
}

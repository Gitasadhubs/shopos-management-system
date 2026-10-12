import { NextResponse } from 'next/server'
import { z } from 'zod'
import { emailField } from '@/lib/auth-schemas'
import { resendVerification } from '@/lib/local-auth'
import { blockCrossOrigin, clientInfo, errorResponse, isSelfHosted, jsonResponse, parseBody } from '@/lib/local-session'

export const runtime = 'nodejs'

// Always the same answer, whether or not the email has an account.
export async function POST(request: Request) {
  if (!isSelfHosted()) return jsonResponse(null, 'Not found.', 404)
  const blocked = await blockCrossOrigin(request)
  if (blocked) return blocked
  const body = await parseBody(request, z.object({ email: emailField }))
  if (body instanceof NextResponse) return body
  try {
    await resendVerification(body.data.email, await clientInfo())
    return jsonResponse(true)
  } catch (error) {
    return errorResponse(error, 'Unable to send the link.')
  }
}

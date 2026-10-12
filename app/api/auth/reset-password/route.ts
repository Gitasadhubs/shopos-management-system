import { NextResponse } from 'next/server'
import { z } from 'zod'
import { passwordField, tokenField } from '@/lib/auth-schemas'
import { resetPassword } from '@/lib/local-auth'
import { blockCrossOrigin, clientInfo, errorResponse, isSelfHosted, jsonResponse, parseBody, setSessionCookie } from '@/lib/local-session'

export const runtime = 'nodejs'

// Sets the new password, signs out every other device and signs this one in.
export async function POST(request: Request) {
  if (!isSelfHosted()) return jsonResponse(null, 'Not found.', 404)
  const blocked = await blockCrossOrigin(request)
  if (blocked) return blocked
  const body = await parseBody(request, z.object({ token: tokenField, password: passwordField }))
  if (body instanceof NextResponse) return body
  try {
    const { token, user } = await resetPassword(body.data.token, body.data.password, await clientInfo())
    return setSessionCookie(jsonResponse({ user }), token)
  } catch (error) {
    return errorResponse(error, 'Unable to reset the password.')
  }
}

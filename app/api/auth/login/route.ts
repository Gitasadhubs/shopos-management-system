import { NextResponse } from 'next/server'
import { z } from 'zod'
import { emailField } from '@/lib/auth-schemas'
import { login } from '@/lib/local-auth'
import { blockCrossOrigin, clientInfo, errorResponse, isSelfHosted, jsonResponse, parseBody, setSessionCookie } from '@/lib/local-session'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  if (!isSelfHosted()) return jsonResponse(null, 'Not found.', 404)
  const blocked = await blockCrossOrigin(request)
  if (blocked) return blocked
  const body = await parseBody(request, z.object({ email: emailField, password: z.string().min(1, 'Enter your password.').max(200) }))
  if (body instanceof NextResponse) return body
  try {
    const { token, user } = await login(body.data, await clientInfo())
    return setSessionCookie(jsonResponse({ user }), token)
  } catch (error) {
    return errorResponse(error, 'Unable to sign in.')
  }
}

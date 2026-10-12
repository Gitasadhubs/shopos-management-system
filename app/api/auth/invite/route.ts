import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { nameField, passwordField, tokenField } from '@/lib/auth-schemas'
import { acceptInvite, getInvite } from '@/lib/local-auth'
import { blockCrossOrigin, clientInfo, errorResponse, isSelfHosted, jsonResponse, parseBody, setSessionCookie } from '@/lib/local-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET shows who the invitation is for; POST accepts it and signs the new account in.
export async function GET(request: NextRequest) {
  if (!isSelfHosted()) return jsonResponse(null, 'Not found.', 404)
  const token = tokenField.safeParse(request.nextUrl.searchParams.get('token'))
  if (!token.success) return jsonResponse(null, 'This invitation link is invalid or has expired.', 400, 'invalid_token')
  try {
    const invite = await getInvite(token.data)
    return invite ? jsonResponse(invite) : jsonResponse(null, 'This invitation link is invalid or has expired.', 400, 'invalid_token')
  } catch (error) {
    return errorResponse(error, 'Unable to load the invitation.')
  }
}

export async function POST(request: Request) {
  if (!isSelfHosted()) return jsonResponse(null, 'Not found.', 404)
  const blocked = await blockCrossOrigin(request)
  if (blocked) return blocked
  const body = await parseBody(request, z.object({ token: tokenField, full_name: nameField, password: passwordField }))
  if (body instanceof NextResponse) return body
  try {
    const { token, user } = await acceptInvite(body.data.token, body.data, await clientInfo())
    return setSessionCookie(jsonResponse({ user }, null, 201), token)
  } catch (error) {
    return errorResponse(error, 'Unable to accept the invitation.')
  }
}

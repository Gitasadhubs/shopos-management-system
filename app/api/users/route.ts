import { NextResponse } from 'next/server'
import { z } from 'zod'
import { emailField, staffRole } from '@/lib/auth-schemas'
import { inviteStaff, listStaff } from '@/lib/local-auth'
import { authorize, errorResponse, isSelfHosted, jsonResponse, parseBody } from '@/lib/local-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Staff accounts and pending invitations. Owner only.
export async function GET(request: Request) {
  if (!isSelfHosted()) return jsonResponse(null, 'Not found.', 404)
  try {
    const auth = await authorize(request, 'users')
    if (auth instanceof NextResponse) return auth
    return jsonResponse(await listStaff(auth.user))
  } catch (error) {
    return errorResponse(error, 'Unable to load staff.')
  }
}

export async function POST(request: Request) {
  if (!isSelfHosted()) return jsonResponse(null, 'Not found.', 404)
  try {
    const auth = await authorize(request, 'users')
    if (auth instanceof NextResponse) return auth
    const body = await parseBody(request, z.object({ email: emailField, role: staffRole, full_name: z.string().trim().max(120).optional() }))
    if (body instanceof NextResponse) return body
    await inviteStaff(auth.user, body.data)
    return jsonResponse(true, null, 201)
  } catch (error) {
    return errorResponse(error, 'Unable to send the invitation.')
  }
}

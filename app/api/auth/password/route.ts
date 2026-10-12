import { NextResponse } from 'next/server'
import { z } from 'zod'
import { passwordField } from '@/lib/auth-schemas'
import { changePassword } from '@/lib/local-auth'
import { authorize, errorResponse, isSelfHosted, jsonResponse, parseBody } from '@/lib/local-session'

export const runtime = 'nodejs'

// Change your own password; every other device is signed out.
export async function POST(request: Request) {
  if (!isSelfHosted()) return jsonResponse(null, 'Not found.', 404)
  try {
    const auth = await authorize(request)
    if (auth instanceof NextResponse) return auth
    const body = await parseBody(request, z.object({ current_password: z.string().min(1, 'Enter your current password.').max(200), new_password: passwordField }))
    if (body instanceof NextResponse) return body
    await changePassword(auth.user, auth.token, body.data)
    return jsonResponse(true)
  } catch (error) {
    return errorResponse(error, 'Unable to change the password.')
  }
}

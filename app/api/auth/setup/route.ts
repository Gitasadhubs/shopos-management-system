import { NextResponse } from 'next/server'
import { z } from 'zod'
import { emailField, nameField, passwordField } from '@/lib/auth-schemas'
import { createPlatformAdmin, hasPlatformAdmin } from '@/lib/local-auth'
import { blockCrossOrigin, errorResponse, isSelfHosted, jsonResponse, parseBody } from '@/lib/local-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// First run only: creates the platform admin who runs this ShopOS install. Closed for good after that.
export async function GET() {
  if (!isSelfHosted()) return jsonResponse(null, 'Not found.', 404)
  try {
    return jsonResponse({ needs_setup: !(await hasPlatformAdmin()) })
  } catch (error) {
    return errorResponse(error, 'Unable to check setup status.')
  }
}

export async function POST(request: Request) {
  if (!isSelfHosted()) return jsonResponse(null, 'Not found.', 404)
  const blocked = await blockCrossOrigin(request)
  if (blocked) return blocked
  const body = await parseBody(request, z.object({ email: emailField, full_name: nameField, password: passwordField }))
  if (body instanceof NextResponse) return body
  try {
    const user = await createPlatformAdmin(body.data)
    return jsonResponse({ email: user.email }, null, 201)
  } catch (error) {
    return errorResponse(error, 'Unable to create the admin account.')
  }
}

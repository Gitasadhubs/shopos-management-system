import { NextResponse } from 'next/server'
import { z } from 'zod'
import { emailField, nameField, passwordField } from '@/lib/auth-schemas'
import { signUpShop } from '@/lib/local-auth'
import { blockCrossOrigin, clientInfo, errorResponse, isSelfHosted, jsonResponse, parseBody } from '@/lib/local-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Public signup: creates a shop on a free trial and its owner account (unverified until the email link).
export async function POST(request: Request) {
  if (!isSelfHosted()) return jsonResponse(null, 'Not found.', 404)
  const blocked = await blockCrossOrigin(request)
  if (blocked) return blocked
  const body = await parseBody(request, z.object({
    shop_name: z.string().trim().min(1, 'Enter your shop name.').max(120),
    phone: z.string().trim().max(40).optional().default(''),
    full_name: nameField,
    email: emailField,
    password: passwordField,
  }))
  if (body instanceof NextResponse) return body
  try {
    const user = await signUpShop(body.data, await clientInfo())
    return jsonResponse({ email: user.email }, null, 201)
  } catch (error) {
    return errorResponse(error, 'Unable to create your shop.')
  }
}

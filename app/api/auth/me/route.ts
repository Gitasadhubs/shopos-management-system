import { NextResponse } from 'next/server'
import { authorize, errorResponse, isSelfHosted, jsonResponse } from '@/lib/local-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  if (!isSelfHosted()) return jsonResponse(null, 'Not found.', 404)
  try {
    const auth = await authorize(request)
    if (auth instanceof NextResponse) return auth
    return jsonResponse({ user: auth.user })
  } catch (error) {
    return errorResponse(error, 'Unable to load your account.')
  }
}

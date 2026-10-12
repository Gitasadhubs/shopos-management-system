import { endSession } from '@/lib/local-auth'
import { blockCrossOrigin, clearSessionCookie, currentSessionToken, errorResponse, isSelfHosted, jsonResponse } from '@/lib/local-session'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  if (!isSelfHosted()) return jsonResponse(null, 'Not found.', 404)
  const blocked = await blockCrossOrigin(request)
  if (blocked) return blocked
  try {
    await endSession(await currentSessionToken())
    return clearSessionCookie(jsonResponse(true))
  } catch (error) {
    return errorResponse(error, 'Unable to sign out.')
  }
}

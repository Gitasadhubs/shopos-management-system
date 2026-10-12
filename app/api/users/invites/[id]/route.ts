import { NextResponse } from 'next/server'
import { revokeInvite } from '@/lib/local-auth'
import { authorize, errorResponse, isSelfHosted, jsonResponse } from '@/lib/local-session'

export const runtime = 'nodejs'

// Cancel a pending invitation so its link stops working. Owner only.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSelfHosted()) return jsonResponse(null, 'Not found.', 404)
  try {
    const auth = await authorize(request, 'users')
    if (auth instanceof NextResponse) return auth
    await revokeInvite(auth.user, (await params).id)
    return jsonResponse(true)
  } catch (error) {
    return errorResponse(error, 'Unable to cancel the invitation.')
  }
}

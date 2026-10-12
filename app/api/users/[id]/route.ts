import { NextResponse } from 'next/server'
import { z } from 'zod'
import { staffRole } from '@/lib/auth-schemas'
import { updateStaff } from '@/lib/local-auth'
import { authorize, errorResponse, isSelfHosted, jsonResponse, parseBody } from '@/lib/local-session'

export const runtime = 'nodejs'

// Change a staff member's role or enable/disable their account. Owner only.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSelfHosted()) return jsonResponse(null, 'Not found.', 404)
  try {
    const auth = await authorize(request, 'users')
    if (auth instanceof NextResponse) return auth
    const body = await parseBody(request, z.object({ role: staffRole.optional(), is_active: z.boolean().optional() }).refine((value) => value.role !== undefined || value.is_active !== undefined, 'Nothing to change.'))
    if (body instanceof NextResponse) return body
    const { id } = await params
    return jsonResponse(await updateStaff(auth.user, id, body.data))
  } catch (error) {
    return errorResponse(error, 'Unable to update the account.')
  }
}

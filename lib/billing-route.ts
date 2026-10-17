import { NextResponse } from 'next/server'
import { authorize, errorResponse, isSelfHosted, jsonResponse, type Authorized } from '@/lib/local-session'
import { can } from '@/lib/permissions'

type BillingAuth = Authorized & { shop: NonNullable<Authorized['user']['shop']> }

// Billing routes are for the shop owner and keep working after the shop has expired: that is when
// paying matters. (authorize() without a permission skips the read-only check.)
export async function withBillingOwner(request: Request, fallback: string, work: (auth: BillingAuth) => Promise<NextResponse>) {
  if (!isSelfHosted()) return jsonResponse(null, 'Not found.', 404)
  try {
    const auth = await authorize(request)
    if (auth instanceof NextResponse) return auth
    if (!auth.user.shop || !can(auth.user.role, 'billing')) return jsonResponse(null, 'Your role does not allow this.', 403, 'forbidden')
    return await work({ ...auth, shop: auth.user.shop })
  } catch (error) {
    return errorResponse(error, fallback)
  }
}

import { cookies, headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { getSessionUser, SESSION_MAX_AGE_SECONDS, type ClientInfo, type SessionShop, type SessionUser } from '@/lib/local-auth'
import { LocalDataError } from '@/lib/local-db'
import { can, type Permission } from '@/lib/permissions'

// Session cookie and request guards for self-hosted mode (SHOPOS_STORAGE=mariadb).

export const isSelfHosted = () => process.env.SHOPOS_STORAGE === 'mariadb'

// Over HTTPS the __Host- prefix makes the browser refuse the cookie unless it is Secure, host-only and path=/.
const secureCookies = () => (process.env.SHOPOS_PUBLIC_URL ?? '').startsWith('https:')
export const sessionCookieName = () => (secureCookies() ? '__Host-shopos_session' : 'shopos_session')

export function setSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(sessionCookieName(), token, { httpOnly: true, secure: secureCookies(), sameSite: 'lax', path: '/', maxAge: SESSION_MAX_AGE_SECONDS })
  return response
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(sessionCookieName(), '', { httpOnly: true, secure: secureCookies(), sameSite: 'lax', path: '/', maxAge: 0 })
  return response
}

export async function currentSessionToken() {
  return (await cookies()).get(sessionCookieName())?.value
}

// The signed-in user for server components (admin pages, server actions).
export async function currentUser() {
  return getSessionUser(await currentSessionToken())
}

export async function clientInfo(): Promise<ClientInfo> {
  const list = await headers()
  // Caddy replaces X-Forwarded-For with the real client address, so the first entry is trustworthy behind it.
  const ip = list.get('x-forwarded-for')?.split(',')[0]?.trim() || list.get('x-real-ip') || 'unknown'
  return { ip, userAgent: list.get('user-agent') }
}

export const jsonResponse = (data: unknown, error: string | null = null, status = 200, code?: string) =>
  NextResponse.json(code ? { data, error, code } : { data, error }, { status, headers: { 'Cache-Control': 'no-store' } })

export function errorResponse(error: unknown, fallback: string) {
  if (error instanceof LocalDataError) return jsonResponse(null, error.message, error.status, error.code)
  console.error(fallback, error)
  return jsonResponse(null, fallback, 500)
}

// Cookies are SameSite=Lax; this also rejects writes posted from another origin.
async function sameOrigin(method: string) {
  if (method === 'GET' || method === 'HEAD') return true
  const list = await headers()
  const origin = list.get('origin')
  if (!origin) return true
  try {
    return new URL(origin).host === list.get('host')
  } catch {
    return false
  }
}

export type Authorized = { user: SessionUser; token: string }
export type ShopAuthorized = Authorized & { shop: SessionShop }

const isWrite = (method: string) => method !== 'GET' && method !== 'HEAD'

export const SUBSCRIPTION_INACTIVE = 'Your ShopOS subscription has ended, so the shop is read-only. The owner can renew it from Billing.'

// Returns the signed-in user, or a response to send back (401 signed out, 403 role or origin not allowed).
// With a permission the route works on shop data, so the user must belong to a shop, and changes
// need a trial or paid subscription (402 otherwise).
export async function authorize(request: Request): Promise<Authorized | NextResponse>
export async function authorize(request: Request, permission: Permission): Promise<ShopAuthorized | NextResponse>
export async function authorize(request: Request, permission?: Permission): Promise<Authorized | ShopAuthorized | NextResponse> {
  if (!(await sameOrigin(request.method))) return jsonResponse(null, 'Cross-origin request blocked.', 403, 'bad_origin')
  const token = await currentSessionToken()
  const user = await getSessionUser(token)
  if (!user || !token) return jsonResponse(null, 'Sign in to continue.', 401, 'signed_out')
  if (!permission) return { user, token }
  if (!user.shop) return jsonResponse(null, 'This account does not belong to a shop.', 403, 'no_shop')
  if (!can(user.role, permission)) return jsonResponse(null, 'Your role does not allow this.', 403, 'forbidden')
  if (isWrite(request.method) && !user.shop.subscription.can_write) return jsonResponse(null, SUBSCRIPTION_INACTIVE, 402, 'subscription_inactive')
  return { user, token, shop: user.shop }
}

// Runs a shop route: checks the session and permission, then maps thrown errors to JSON responses.
export async function withShop(request: Request, permission: Permission, fallback: string, work: (auth: ShopAuthorized) => Promise<NextResponse>) {
  // These features only exist with MariaDB storage.
  if (!isSelfHosted()) return jsonResponse(null, 'Not found.', 404)
  try {
    const auth = await authorize(request, permission)
    if (auth instanceof NextResponse) return auth
    return await work(auth)
  } catch (error) {
    return errorResponse(error, fallback)
  }
}

// For routes used before sign-in (login, reset, invite acceptance).
export async function blockCrossOrigin(request: Request) {
  return (await sameOrigin(request.method)) ? null : jsonResponse(null, 'Cross-origin request blocked.', 403, 'bad_origin')
}

export async function parseBody<T>(request: Request, schema: import('zod').ZodType<T>): Promise<{ data: T } | NextResponse> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonResponse(null, 'Request body must be valid JSON.', 400)
  }
  const parsed = schema.safeParse(body)
  return parsed.success ? { data: parsed.data } : jsonResponse(null, parsed.error.issues[0]?.message ?? 'Invalid request.', 400)
}

import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { getSessionUser } from '@/lib/local-auth'
import { currentSessionToken, isSelfHosted, sessionCookieName } from '@/lib/local-session'

// Session checks for admin server actions, which run outside the proxy's page checks.
export async function requireAdminForAction() {
  if (!isSelfHosted()) notFound()
  const token = await currentSessionToken()
  const user = await getSessionUser(token)
  if (!user || !token || user.role !== 'admin') notFound()
  return { ...user, token }
}

export async function clearSessionCookieOnAction() {
  const secure = (process.env.SHOPOS_PUBLIC_URL ?? '').startsWith('https:')
  ;(await cookies()).set(sessionCookieName(), '', { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 0 })
}

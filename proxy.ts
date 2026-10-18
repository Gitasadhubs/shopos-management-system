import { NextResponse, type NextRequest } from 'next/server'
import { getSessionUser, hasPlatformAdmin } from '@/lib/local-auth'
import { sessionCookieName } from '@/lib/local-session'
import { can, type Permission } from '@/lib/permissions'

export async function proxy(request: NextRequest) {
  return selfHostedProxy(request, NextResponse.next({ request }))
}

// Self-hosted mode: email + password accounts in MariaDB (lib/local-auth.ts). The first account
// (/setup) is the platform admin; shops sign up at /signup.
const publicPaths = ['/login', '/signup', '/forgot-password', '/reset-password', '/verify-email', '/accept-invite', '/setup']
const signedOutOnly = ['/login', '/signup', '/forgot-password', '/setup']
const roleRoutes: Array<{ prefix: string; permission: Permission }> = [
  { prefix: '/inventory', permission: 'inventory' },
  { prefix: '/suppliers', permission: 'suppliers' },
  { prefix: '/purchases', permission: 'purchases' },
  { prefix: '/reports', permission: 'reports' },
  { prefix: '/day-end', permission: 'reports' },
  { prefix: '/expenses', permission: 'expenses' },
  { prefix: '/settings/users', permission: 'users' },
  { prefix: '/billing', permission: 'billing' },
]

async function selfHostedProxy(request: NextRequest, response: NextResponse) {
  const path = request.nextUrl.pathname
  const redirect = (to: string) => NextResponse.redirect(new URL(to, request.url))
  const isAdminPath = path === '/admin' || path.startsWith('/admin/')

  // The partner program's pages (/partner and each partner's private /partner/<token>) are open to
  // everyone, signed in or not: a partner may also be a shop owner, or the admin checking a page.
  if (path === '/partner' || path.startsWith('/partner/')) return response
  const user = await getSessionUser(request.cookies.get(sessionCookieName())?.value)
  // The admin area does not exist for anyone else, signed in or not.
  if (isAdminPath) return user?.role === 'admin' ? response : NextResponse.rewrite(new URL('/404', request.url))
  if (!user) {
    // A fresh install has no admin yet: everything leads to setup until one is created.
    if (!(await hasPlatformAdmin())) return path === '/setup' ? response : redirect('/setup')
    if (path === '/setup') return redirect('/login')
    if (publicPaths.includes(path)) return response
    const login = request.nextUrl.clone()
    login.pathname = '/login'
    login.search = ''
    if (path !== '/' && path !== '/dashboard') login.searchParams.set('next', path)
    return NextResponse.redirect(login)
  }
  const home = user.role === 'admin' ? '/admin' : '/dashboard'
  if (signedOutOnly.includes(path)) return redirect(home)
  // Platform admins have no shop; their workspace is the admin area.
  if (user.role === 'admin') return redirect('/admin')
  // A shop waiting for its card (trials need one): the owner adds it on Billing first. Staff see a
  // notice in the app instead.
  if (user.shop?.subscription.needs_card && user.role === 'owner' && path !== '/billing' && !path.startsWith('/billing/')) return redirect('/billing')
  const rule = roleRoutes.find(({ prefix }) => path === prefix || path.startsWith(`${prefix}/`))
  if (rule && !can(user.role, rule.permission)) return redirect('/dashboard')
  return response
}

export const config = { matcher: ['/((?!api|_next|sw\\.js|robots\\.txt|manifest\\.webmanifest|offline|icons(?:/|$)|workbox-[^/]*\\.js|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'] }

export default proxy


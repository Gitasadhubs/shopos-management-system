import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getSessionUser, hasPlatformAdmin } from '@/lib/local-auth'
import { sessionCookieName } from '@/lib/local-session'
import { can, type Permission } from '@/lib/permissions'

const protectedPaths = ['/dashboard', '/pos', '/sales', '/inventory', '/customers', '/suppliers', '/purchases', '/reports', '/expenses', '/day-end', '/settings', '/setup', '/billing']
const authPaths = ['/login', '/signup', '/forgot-password', '/reset-password']

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname
  const response = NextResponse.next({ request })
  const isAdminPath = path === '/admin' || path.startsWith('/admin/')
  if (process.env.SHOPOS_STORAGE === 'mariadb') return selfHostedProxy(request, response)
  // RSC navigations must pass through untouched so the client can hydrate and attach handlers.
  if (request.headers.get('RSC') === '1' || request.headers.has('Next-Router-State-Tree')) {
    return NextResponse.next({ request })
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://khmkububzbvosbbjyiyk.supabase.co'
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Keep the preview reachable when deployment variables have not been configured yet.
  if (!supabaseUrl || !supabaseKey || supabaseKey === 'PASTE_ANON_KEY_HERE') return response

  const supabase = createServerClient(
    supabaseUrl,
    supabaseKey,
    { cookies: { getAll: () => request.cookies.getAll(), setAll: (cookies) => cookies.forEach(({ name, value, options }) => { request.cookies.set(name, value); response.cookies.set(name, value, options) }) } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (isAdminPath) {
    if (!user) return NextResponse.rewrite(new URL('/404', request.url))
    const { data: admin } = await supabase.from('platform_admins').select('id').eq('user_id', user.id).maybeSingle()
    if (!admin) return NextResponse.rewrite(new URL('/404', request.url))
    return response
  }
  const isProtected = protectedPaths.some((item) => path === item || path.startsWith(`${item}/`))
  if (isProtected && !user) {
    const url = request.nextUrl.clone(); url.pathname = '/login'; url.searchParams.set('next', path); return NextResponse.redirect(url)
  }
  if (authPaths.includes(path) && user) return NextResponse.redirect(new URL('/dashboard', request.url))
  if (user && isProtected) {
    const { data: role } = await supabase.from('user_roles').select('shop_id, role').eq('user_id', user.id).maybeSingle()
    const { data: shop } = role ? await supabase.from('shop_settings').select('shop_id, setup_completed, subscription_status').eq('shop_id', role.shop_id).maybeSingle() : { data: null }
    if (!role || !shop) return path === '/setup' ? response : NextResponse.redirect(new URL('/setup', request.url))
    if (!shop.setup_completed && path !== '/setup') return NextResponse.redirect(new URL('/setup', request.url))
    if (shop.setup_completed && path === '/setup') return NextResponse.redirect(new URL('/dashboard', request.url))
    const isDemo = user.email?.toLowerCase() === 'demo@shopos.app'
    const billingAllowed = path === '/billing' || path === '/settings/profile'
    if (!isDemo && shop.subscription_status === 'expired' && !billingAllowed) return NextResponse.redirect(new URL('/billing', request.url))
    const cashierAllowed = ['/dashboard', '/pos', '/customers']
    if (role.role === 'cashier' && !cashierAllowed.some((allowed) => path === allowed || path.startsWith(`${allowed}/`))) return NextResponse.redirect(new URL('/dashboard', request.url))
    if (role.role === 'manager' && path.startsWith('/settings/users')) return NextResponse.redirect(new URL('/settings', request.url))
  }
  return response
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

function warnOnLoop(request: NextRequest, destination: string) {
  if (process.env.NODE_ENV === 'development' && request.nextUrl.pathname === destination) console.warn('[v0] proxy redirect loop prevented', destination)
}
void warnOnLoop


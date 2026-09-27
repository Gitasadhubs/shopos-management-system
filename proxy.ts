import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const protectedPaths = ['/dashboard', '/pos', '/inventory', '/customers', '/suppliers', '/purchases', '/reports', '/settings', '/setup', '/billing']
const authPaths = ['/login', '/signup', '/forgot-password', '/reset-password']

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => request.cookies.getAll(), setAll: (cookies) => cookies.forEach(({ name, value, options }) => { request.cookies.set(name, value); response.cookies.set(name, value, options) }) } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  const path = request.nextUrl.pathname
  const isAdminPath = path === '/admin' || path.startsWith('/admin/')
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

export const config = { matcher: ['/((?!api|_next|sw\\.js|manifest\\.webmanifest|offline|icons(?:/|$)|workbox-[^/]*\\.js|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'] }

export default proxy

function warnOnLoop(request: NextRequest, destination: string) {
  if (process.env.NODE_ENV === 'development' && request.nextUrl.pathname === destination) console.warn('[v0] proxy redirect loop prevented', destination)
}
void warnOnLoop


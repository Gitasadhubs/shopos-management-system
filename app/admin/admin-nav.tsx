'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CreditCard, Handshake, LayoutDashboard, Store, UserRound, Wallet } from 'lucide-react'

const links = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard },
  { href: '/admin/shops', label: 'Shops', icon: Store },
  { href: '/admin/subscriptions', label: 'Subscriptions', icon: CreditCard },
  { href: '/admin/payments', label: 'Payments', icon: Wallet },
  { href: '/admin/affiliates', label: 'Affiliates', icon: Handshake },
  { href: '/admin/account', label: 'Account', icon: UserRound },
]

export function AdminNav({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname()
  const active = (href: string) => (href === '/admin' ? pathname === '/admin' : pathname === href || pathname.startsWith(`${href}/`))
  if (mobile) {
    return <nav aria-label="Admin" className="flex gap-1 overflow-x-auto px-3 pb-3">{links.map(({ href, label }) => <Link key={href} href={href} className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium ${active(href) ? 'bg-emerald-500 text-white' : 'bg-white/10 text-stone-200'}`}>{label}</Link>)}</nav>
  }
  return <nav aria-label="Admin" className="mt-8 grid gap-1">{links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition ${active(href) ? 'bg-emerald-500/15 text-emerald-300' : 'text-stone-300 hover:bg-white/5 hover:text-white'}`}><Icon className="size-4" />{label}</Link>)}</nav>
}

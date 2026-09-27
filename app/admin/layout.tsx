import Link from 'next/link'
import { LayoutDashboard, Store, CreditCard, Wallet, LogOut } from 'lucide-react'
import { adminSignOut } from './actions'

const links = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/shops', label: 'Shops', icon: Store },
  { href: '/admin/subscriptions', label: 'Subscriptions', icon: CreditCard },
  { href: '/admin/payments', label: 'Payments', icon: Wallet },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-[#fbfaf7] text-stone-900"><aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-stone-200 bg-white p-6 md:block"><Link href="/admin" className="text-xl font-bold">Shop<span className="text-emerald-600">OS</span> <span className="text-stone-400">Admin</span></Link><nav className="mt-10 space-y-1">{links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-stone-600 hover:bg-emerald-50 hover:text-emerald-700"><Icon className="size-4" />{label}</Link>)}</nav><form action={adminSignOut} className="absolute bottom-6 left-6 right-6"><button className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-stone-500 hover:bg-stone-100"><LogOut className="size-4" />Sign out</button></form></aside><main className="min-h-screen md:pl-64"><div className="border-b border-stone-200 bg-white px-5 py-4 md:hidden"><Link href="/admin" className="font-bold">Shop<span className="text-emerald-600">OS</span> Admin</Link></div>{children}</main></div>
}

import Link from 'next/link'
import { LogOut, ShieldCheck } from 'lucide-react'
import { requirePlatformAdmin } from '@/lib/admin'
import { adminSignOut } from './actions'
import { AdminNav } from './admin-nav'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requirePlatformAdmin()
  return (
    <div className="min-h-screen bg-[#fbfaf7] text-stone-900">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col bg-stone-900 p-6 text-white md:flex">
        <Link href="/admin" className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-lg shadow-emerald-500/30"><ShieldCheck className="size-5" /></span>
          <span><span className="block text-lg font-bold">Shop<span className="text-emerald-400">OS</span></span><span className="block text-[11px] uppercase tracking-wider text-stone-400">Admin</span></span>
        </Link>
        <AdminNav />
        <div className="mt-auto rounded-xl bg-white/5 p-4">
          <p className="text-xs text-stone-400">Signed in as</p>
          <p className="mt-1 truncate text-sm font-semibold">{admin.full_name}</p>
          <p className="truncate text-xs text-stone-400">{admin.email}</p>
          <form action={adminSignOut} className="mt-3"><button className="flex w-full items-center gap-2 rounded-lg px-2 text-sm font-medium text-stone-300 hover:bg-white/10 hover:text-white"><LogOut className="size-4" />Sign out</button></form>
        </div>
      </aside>
      <div className="bg-stone-900 text-white md:hidden">
        <div className="flex items-center justify-between px-4 py-3"><Link href="/admin" className="font-bold">Shop<span className="text-emerald-400">OS</span> Admin</Link><form action={adminSignOut}><button aria-label="Sign out" className="flex items-center gap-2 text-sm text-stone-300"><LogOut className="size-4" /></button></form></div>
        <AdminNav mobile />
      </div>
      <main className="min-h-screen md:pl-64">{children}</main>
    </div>
  )
}

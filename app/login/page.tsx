import { Suspense } from 'react'
import { AuthPage } from '@/app/auth-pages'

function LoginSkeleton() {
  return <main className="flex min-h-screen items-center justify-center bg-[#fbfaf7] px-4 py-10"><div className="w-full max-w-[420px]"><div className="mb-8 flex flex-col items-center gap-3"><div className="size-12 animate-pulse rounded-2xl bg-stone-200" /><div className="h-7 w-24 animate-pulse rounded bg-stone-200" /><div className="h-4 w-40 animate-pulse rounded bg-stone-200" /></div><section className="rounded-3xl border border-stone-200/80 bg-white p-7 shadow-xl shadow-stone-900/5"><div className="h-7 w-44 animate-pulse rounded bg-stone-200" /><div className="mt-3 h-4 w-64 animate-pulse rounded bg-stone-100" /><div className="mt-6 flex flex-col gap-4"><div className="h-12 animate-pulse rounded-xl bg-stone-100" /><div className="h-12 animate-pulse rounded-xl bg-stone-100" /><div className="h-12 animate-pulse rounded-full bg-stone-200" /></div></section></div></main>
}

export default function Login() {
  return <Suspense fallback={<LoginSkeleton />}><AuthPage type="login" /></Suspense>
}

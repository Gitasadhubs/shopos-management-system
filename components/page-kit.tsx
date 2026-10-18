'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { formatDate, formatDateTime, formatMoney } from '@/lib/format'
import { playSound } from '@/lib/sounds'

// Building blocks shared by the shop screens.

// In the signed-in shop's currency and locale (lib/format.ts, set by the auth provider).
export const money = (value: number) => formatMoney(value)
export const shortDate = (value: string) => formatDate(value)
export const dateTime = (value: string) => formatDateTime(value)

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message)
  }
}

// JSON request to a ShopOS API route; throws ApiError with the server's message.
// A request never waits forever: reads give up after 30 s, changes after 60 s.
const READ_TIMEOUT_MS = 30_000
const WRITE_TIMEOUT_MS = 60_000

export async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const method = init?.method ?? 'GET'
  const write = method !== 'GET'
  let response: Response
  try {
    response = await fetch(url, {
      method,
      cache: 'no-store',
      headers: init?.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(write ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      // A slow save may still have gone through, so say so rather than inviting a blind retry.
      throw new ApiError(write ? 'The server did not answer in time. Check whether it was saved before trying again.' : 'The server is taking too long to answer. Try again.', 0, 'timeout')
    }
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0)
  }
  const body = await response.json().catch(() => ({ data: null, error: 'The server sent an unexpected response.' }))
  if (!response.ok) throw new ApiError(body.error ?? 'Something went wrong.', response.status, body.code)
  return body.data as T
}

export const errorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

// Loads a URL and reloads on demand; only the newest request may update state.
export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(Boolean(url))
  const latest = useRef(0)
  const load = useCallback(async () => {
    if (!url) return
    const request = ++latest.current
    setLoading(true)
    setError('')
    try {
      const result = await api<T>(url)
      if (request === latest.current) setData(result)
    } catch (loadError) {
      if (request === latest.current) setError(errorMessage(loadError, 'Could not load data.'))
    } finally {
      if (request === latest.current) setLoading(false)
    }
  }, [url])
  useEffect(() => { void load() }, [load])
  return { data, error, loading, reload: load, setData }
}

// Runs an action with busy/error/success state and plays the matching sound.
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const run = useCallback(async (work: () => Promise<string | void>, sound: 'success' | 'add' | 'sale' = 'success') => {
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const message = await work()
      if (message) setSuccess(message)
      playSound(sound)
      return true
    } catch (actionError) {
      setError(errorMessage(actionError, 'Something went wrong.'))
      playSound('error')
      return false
    } finally {
      setBusy(false)
    }
  }, [])
  return { busy, error, success, setError, setSuccess, run }
}

export function PageHeader({ title, description, actions, art }: { title: string; description?: string; actions?: React.ReactNode; art?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col justify-between gap-4 shopos-rise sm:flex-row sm:items-center">
      <div className="flex items-center gap-4">
        {art && <div className="hidden shrink-0 sm:block">{art}</div>}
        <div><h1 className="text-3xl font-bold tracking-tight text-stone-900">{title}</h1>{description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}</div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function Notice({ tone, children, action }: { tone: 'error' | 'success' | 'info' | 'warning'; children: React.ReactNode; action?: React.ReactNode }) {
  const styles = {
    error: 'border-rose-200 bg-rose-50 text-rose-700',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    info: 'border-sky-200 bg-sky-50 text-sky-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
  }
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm shopos-rise ${styles[tone]}`}>
      <span>{children}</span>
      {action}
    </div>
  )
}

const TONES = {
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  violet: 'bg-violet-50 text-violet-700 ring-violet-100',
  amber: 'bg-amber-50 text-amber-700 ring-amber-100',
  sky: 'bg-sky-50 text-sky-700 ring-sky-100',
  rose: 'bg-rose-50 text-rose-700 ring-rose-100',
} as const
export type Tone = keyof typeof TONES

// Animates a number from its previous value to the new one.
export function useCountUp(value: number, duration = 650) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    const start = from.current
    from.current = value
    if (start === value || typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setShown(value)
      return undefined
    }
    let frame = 0
    const began = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - began) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      setShown(progress === 1 ? value : start + (value - start) * eased)
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, duration])
  return shown
}

export function StatCard({ title, value, format = (number) => String(Math.round(number)), loading, note, icon: Icon, tone = 'emerald', delay = 0 }: { title: string; value: number; format?: (value: number) => string; loading?: boolean; note: React.ReactNode; icon: LucideIcon; tone?: Tone; delay?: number }) {
  const shown = useCountUp(loading ? 0 : value)
  return (
    <Card className="overflow-hidden transition-shadow hover:shadow-md shopos-rise" style={{ animationDelay: `${delay}ms` }}>
      <CardContent className="relative p-5">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-sm text-muted-foreground">{title}</p><p className="mt-2 text-2xl font-bold tabular-nums text-stone-900">{loading ? 'Loading…' : format(shown)}</p><p className="mt-2 text-xs text-muted-foreground">{note}</p></div>
          <div className={`flex size-11 items-center justify-center rounded-xl ring-4 ${TONES[tone]}`}><Icon className="size-5" /></div>
        </div>
      </CardContent>
    </Card>
  )
}

// A coloured initial tile, so lists of products and people are easy to scan.
const AVATAR_COLORS = ['bg-emerald-100 text-emerald-800', 'bg-amber-100 text-amber-800', 'bg-sky-100 text-sky-800', 'bg-violet-100 text-violet-800', 'bg-rose-100 text-rose-800', 'bg-lime-100 text-lime-800', 'bg-orange-100 text-orange-800', 'bg-teal-100 text-teal-800']
export function colorFor(text: string) {
  let hash = 0
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}
export function Avatar({ name, className = 'size-10 text-sm' }: { name: string; className?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'
  return <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center rounded-xl font-bold ${colorFor(name)} ${className}`}>{initials}</span>
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return <div className="grid gap-3 p-4" aria-hidden="true">{Array.from({ length: rows }, (_, index) => <div key={index} className="h-12 rounded-lg shopos-shimmer" />)}</div>
}

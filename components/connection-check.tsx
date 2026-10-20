'use client'

import { useEffect, useState } from 'react'
import { LoaderCircle, RefreshCw, Wifi, WifiOff, ServerCrash, Globe } from 'lucide-react'
import { useConnectivity } from '@/hooks/use-connectivity'
import { t } from '@/lib/i18n'
import type { Connection } from '@/lib/connectivity'

const LOOK: Record<Connection, { key: string; hint: string; icon: typeof Wifi; tone: string }> = {
  checking: { key: 'conn.checking', hint: 'conn.hintChecking', icon: Wifi, tone: 'bg-stone-100 text-stone-700 ring-stone-200' },
  online: { key: 'conn.online', hint: 'conn.hintOnline', icon: Wifi, tone: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  'no-network': { key: 'conn.noNetwork', hint: 'conn.hintNoNetwork', icon: WifiOff, tone: 'bg-rose-50 text-rose-800 ring-rose-200' },
  'no-internet': { key: 'conn.noInternet', hint: 'conn.hintNoInternet', icon: Globe, tone: 'bg-rose-50 text-rose-800 ring-rose-200' },
  'server-down': { key: 'conn.serverDown', hint: 'conn.hintServerDown', icon: ServerCrash, tone: 'bg-amber-50 text-amber-900 ring-amber-200' },
}

// What the connection checker found, why, and a button to check again now.
export function connectionHint(status: Connection) {
  return t(LOOK[status].hint)
}

export function ConnectionCheck() {
  const { status, checking, checkedAt, latencyMs, checkNow } = useConnectivity()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 5000); return () => window.clearInterval(timer) }, [])
  const look = LOOK[status]
  const Icon = look.icon
  const seconds = checkedAt ? Math.max(0, Math.round((now - checkedAt) / 1000)) : null
  const when = seconds === null ? '' : seconds < 5 ? t('conn.justChecked') : t('conn.checkedAgo', { seconds })
  return (
    <button
      type="button"
      onClick={() => void checkNow()}
      disabled={checking}
      title={`${t(look.hint)}${when ? `\n${when}` : ''}\n${t('conn.tapToCheck')}`}
      aria-label={`${t(look.key)}. ${t('conn.tapToCheck')}`}
      className={`inline-flex h-10 items-center gap-2 rounded-lg px-3 text-xs font-semibold ring-1 transition-colors ${look.tone}`}
    >
      <Icon className="size-4" aria-hidden="true" />
      <span data-connection={status}>{t(look.key)}{status === 'online' && latencyMs !== null ? ` · ${t('conn.latency', { ms: latencyMs })}` : ''}</span>
      {checking ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-3.5 opacity-60" aria-hidden="true" />}
    </button>
  )
}

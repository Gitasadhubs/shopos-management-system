'use client'

import { useState } from 'react'
import { WifiOff, RefreshCw, Cloud, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useOnlineStatus } from '@/hooks/use-online-status'
import { useSyncEngine } from '@/hooks/use-sync-engine'

export function OfflineStatus() {
  const { isOnline } = useOnlineStatus()
  const { isSyncing, pendingCount, triggerSync } = useSyncEngine()
  const [open, setOpen] = useState(false)
  const label = !isOnline ? `Offline (${pendingCount})` : isSyncing ? `Syncing (${pendingCount})` : 'Synced'
  const tone = !isOnline ? 'border-rose-200 bg-rose-50 text-rose-700' : isSyncing ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
  return <>
    {!isOnline && <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-center text-sm font-medium text-rose-800"><WifiOff className="mr-2 inline size-4" />You&apos;re offline. Sales will be saved and synced automatically.</div>}
    <div className="relative">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold shadow-sm ${tone}`}><Cloud className="size-3.5" />{label}<ChevronDown className="size-3.5" /></button>
      {open && <div className="absolute right-0 top-12 z-50 w-64 rounded-2xl border bg-white p-4 text-sm shadow-xl"><p className="font-semibold text-slate-900">Sync status</p><p className="mt-1 text-slate-500">{pendingCount} pending item{pendingCount === 1 ? '' : 's'}</p><Button className="mt-3 w-full" size="sm" variant="outline" disabled={isSyncing || !isOnline} onClick={() => void triggerSync()}><RefreshCw className="mr-2 size-4" />Sync now</Button></div>}
    </div>
  </>
}

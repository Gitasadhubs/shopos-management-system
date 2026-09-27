'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { getLastSyncAt, getPendingCount, pullLatest, syncAll } from '@/lib/offline/sync'

const SyncContext = createContext<{ isSyncing: boolean; lastSyncAt: number | null; pendingCount: number; triggerSync: () => Promise<void> }>({ isSyncing: false, lastSyncAt: null, pendingCount: 0, triggerSync: async () => {} })
export function SyncProvider({ children, enabled = true }: { children: React.ReactNode; enabled?: boolean }) {
  const [isSyncing, setIsSyncing] = useState(false); const [lastSyncAt, setLastSyncAt] = useState<number | null>(null); const [pendingCount, setPendingCount] = useState(0)
  const refresh = async () => { setPendingCount(await getPendingCount()); setLastSyncAt(await getLastSyncAt()) }
  const triggerSync = async () => { setIsSyncing(true); await syncAll(); await refresh(); setIsSyncing(false) }
  useEffect(() => { if (!enabled) return; void refresh(); if (navigator.onLine) void pullLatest(); const onOnline = () => void triggerSync(); const onVisible = () => { if (document.visibilityState === 'visible' && navigator.onLine) void triggerSync() }; window.addEventListener('online', onOnline); document.addEventListener('visibilitychange', onVisible); const interval = window.setInterval(() => { if (navigator.onLine) void triggerSync() }, 30000); return () => { window.removeEventListener('online', onOnline); document.removeEventListener('visibilitychange', onVisible); window.clearInterval(interval) } }, [enabled])
  return <SyncContext.Provider value={useMemo(() => ({ isSyncing, lastSyncAt, pendingCount, triggerSync }), [isSyncing, lastSyncAt, pendingCount])}>{children}</SyncContext.Provider>
}
export const useSyncEngine = () => useContext(SyncContext)

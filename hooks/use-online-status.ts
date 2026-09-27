'use client'
import { useEffect, useState } from 'react'
import { getMeta, setMeta } from '@/lib/offline/repo'

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine)
  const [wasOffline, setWasOffline] = useState(false)
  useEffect(() => {
    let successes = 0
    let mounted = true
    const confirm = async () => {
      if (!navigator.onLine) { successes = 0; setIsOnline(false); setWasOffline(true); await setMeta('last_online_status', false); return }
      try { const response = await fetch('/api/health', { cache: 'no-store' }); if (!response.ok) throw new Error('health check failed'); successes += 1; if (successes >= 2 && mounted) { setIsOnline(true); setWasOffline(false); await setMeta('last_online_status', true) } } catch { successes = 0; if (mounted) { setIsOnline(false); setWasOffline(true); await setMeta('last_online_status', false) } }
    }
    const offline = () => { successes = 0; setIsOnline(false); setWasOffline(true); void setMeta('last_online_status', false) }
    const online = () => { successes = 0; void confirm() }
    window.addEventListener('offline', offline); window.addEventListener('online', online); void getMeta<boolean>('last_online_status').then((status) => { if (status === false && mounted) setWasOffline(true) }); void confirm()
    const timer = window.setInterval(confirm, 15000)
    return () => { mounted = false; window.clearInterval(timer); window.removeEventListener('offline', offline); window.removeEventListener('online', online) }
  }, [])
  return { isOnline, wasOffline }
}

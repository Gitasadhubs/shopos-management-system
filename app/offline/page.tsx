"use client"

import { CloudOff, RefreshCw, ShoppingCart } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"

export default function OfflinePage() {
  const [isOnline, setIsOnline] = useState(false)

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      window.location.assign("/dashboard")
    }
    window.addEventListener("online", handleOnline)
    return () => window.removeEventListener("online", handleOnline)
  }, [])

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="flex w-full max-w-md flex-col items-center gap-8 text-center">
        <div className="flex size-20 items-center justify-center rounded-3xl bg-primary/10 text-primary">
          <CloudOff aria-hidden="true" className="size-10" />
        </div>
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">ShopOS</p>
          <h1 className="text-4xl font-bold tracking-tight text-foreground">You&apos;re offline</h1>
          <p className="text-base leading-7 text-muted-foreground">
            Your sales are still being saved locally. Everything will sync when you&apos;re back online.
          </p>
        </div>
        <div className="flex w-full flex-col gap-3 rounded-2xl border border-border bg-card p-5 text-left shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">Pending sync</span>
            <span className="rounded-full bg-muted px-3 py-1 text-sm font-semibold text-muted-foreground">0 items</span>
          </div>
          <p className="text-sm text-muted-foreground">Pending sales will appear here once offline storage is connected.</p>
        </div>
        <div className="flex w-full flex-col gap-3 sm:flex-row">
          <Link className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90" href="/pos">
            <ShoppingCart aria-hidden="true" className="size-4" />
            Go to POS
          </Link>
          <button className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted" onClick={() => window.location.reload()} type="button">
            <RefreshCw aria-hidden="true" className="size-4" />
            Try again
          </button>
        </div>
        {isOnline && <p className="text-sm text-primary">Connection restored. Taking you back to the dashboard...</p>}
      </div>
    </main>
  )
}

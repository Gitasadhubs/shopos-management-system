"use client"

import { RefreshCw, ShoppingCart } from "lucide-react"
import { OfflineIllustration } from "@/components/illustrations"
import { ConnectionCheck, connectionHint } from "@/components/connection-check"
import { useConnectivity } from "@/hooks/use-connectivity"
import Link from "next/link"
import { useEffect, useRef } from "react"

export default function OfflinePage() {
  const connection = useConnectivity()

  // The service worker shows this page at the address that could not load, so once the server answers
  // again a reload opens that page. Only a direct visit to /offline goes to the dashboard. It waits to see
  // the connection down first, so a page that fails for another reason cannot reload in a loop.
  const sawOffline = useRef(false)
  useEffect(() => {
    if (connection.offline) sawOffline.current = true
    if (!connection.online || !sawOffline.current) return
    if (window.location.pathname === "/offline") window.location.assign("/dashboard")
    else window.location.reload()
  }, [connection.online, connection.offline])

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="flex w-full max-w-md flex-col items-center gap-8 text-center">
        <OfflineIllustration className="h-40 w-auto shopos-float" />
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">ShopOS</p>
          <h1 className="text-4xl font-bold tracking-tight text-foreground">You&apos;re offline</h1>
          <p className="text-base leading-7 text-muted-foreground">
            This page needs a connection. The till still works: open the POS to keep selling. Sales are kept on this device and sent when the connection is back.
          </p>
          {connection.offline && <p className="text-sm text-muted-foreground">{connectionHint(connection.status)}</p>}
        </div>
        <ConnectionCheck />
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
      </div>
    </main>
  )
}

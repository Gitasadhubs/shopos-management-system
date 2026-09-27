'use client'
import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { getRecentSyncLog } from '@/lib/offline/repo'
import type { SyncLogEntry } from '@/lib/offline/db'
export default function SyncLogPage() { const [rows, setRows] = useState<SyncLogEntry[]>([]); useEffect(() => { void getRecentSyncLog().then(setRows) }, []); return <main className="min-h-screen bg-stone-50 p-6 sm:p-10"><div className="mx-auto max-w-4xl"><h1 className="text-3xl font-bold text-stone-900">Sync log</h1><p className="mt-1 text-sm text-muted-foreground">Offline activity and reconciliation history.</p><Card className="mt-6"><CardHeader><CardTitle>Recent events</CardTitle></CardHeader><CardContent className="flex flex-col gap-3">{rows.length ? rows.map((row) => <div key={row.id} className="flex items-center justify-between rounded-xl border bg-white p-4"><div><p className="font-medium capitalize">{row.type} · {row.details}</p><p className="text-xs text-muted-foreground">{new Date(row.created_at).toLocaleString()}</p></div><Badge variant={row.status === 'failed' ? 'destructive' : 'secondary'}>{row.status}</Badge></div>) : <p className="text-sm text-muted-foreground">No sync events yet.</p>}</CardContent></Card></div></main> }

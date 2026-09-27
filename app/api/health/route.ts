import { NextResponse } from 'next/server'
import { localDbHealth } from '@/lib/local-db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export function GET() {
	if (process.env.SHOPOS_STORAGE === 'sqlite') {
		try {
			localDbHealth()
			return NextResponse.json({ ok: true, storage: 'sqlite', ts: Date.now() }, { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } })
		} catch {
			return NextResponse.json({ ok: false, error: 'SQLite database is unavailable.' }, { status: 503 })
		}
	}
	return NextResponse.json({ ok: true, storage: 'supabase', ts: Date.now() }, { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } })
}

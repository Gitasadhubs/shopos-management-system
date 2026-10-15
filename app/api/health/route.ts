import { NextResponse } from 'next/server'
import { localDbHealth } from '@/lib/local-db'
import { storageHealth } from '@/lib/storage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const noStore = { 'Cache-Control': 'no-store, no-cache, must-revalidate' }

export async function GET() {
	if (process.env.SHOPOS_STORAGE === 'mariadb') {
		try {
			await localDbHealth()
		} catch {
			return NextResponse.json({ ok: false, error: 'Database is unavailable.' }, { status: 503, headers: noStore })
		}
		// File storage is reported but does not fail the check: sales still work while it is down.
		const files = await storageHealth().catch(() => 'error')
		return NextResponse.json({ ok: true, storage: 'mariadb', files, ts: Date.now() }, { headers: noStore })
	}
	return NextResponse.json({ ok: true, storage: 'supabase', ts: Date.now() }, { headers: noStore })
}

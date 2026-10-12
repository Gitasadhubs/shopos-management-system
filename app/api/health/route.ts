import { NextResponse } from 'next/server'
import { localDbHealth } from '@/lib/local-db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const noStore = { 'Cache-Control': 'no-store, no-cache, must-revalidate' }

export async function GET() {
	if (process.env.SHOPOS_STORAGE === 'mariadb') {
		try {
			await localDbHealth()
			return NextResponse.json({ ok: true, storage: 'mariadb', ts: Date.now() }, { headers: noStore })
		} catch {
			return NextResponse.json({ ok: false, error: 'Database is unavailable.' }, { status: 503, headers: noStore })
		}
	}
	return NextResponse.json({ ok: true, storage: 'supabase', ts: Date.now() }, { headers: noStore })
}

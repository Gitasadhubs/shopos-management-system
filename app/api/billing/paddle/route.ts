import { NextResponse } from 'next/server'
import { LocalDataError } from '@/lib/local-db'
import { handlePaddleEvent } from '@/lib/local-billing'
import { isSelfHosted } from '@/lib/local-session'
import { verifyPaddleSignature, webhookSecret, type PaddleEvent } from '@/lib/paddle'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Paddle's webhook (notification destination): https://<app>/api/billing/paddle. Only requests signed
// with SHOPOS_PADDLE_WEBHOOK_SECRET are acted on. A 2xx tells Paddle the event is handled; anything
// else makes it retry later, so errors that a retry could fix return 500.
export async function POST(request: Request) {
  if (!isSelfHosted()) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const secret = webhookSecret()
  if (!secret) return NextResponse.json({ error: 'Card billing is not set up.' }, { status: 503 })
  const body = await request.text()
  if (body.length > 512_000) return NextResponse.json({ error: 'Too large.' }, { status: 413 })
  if (!verifyPaddleSignature(request.headers.get('paddle-signature'), body, secret)) return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 })
  let event: PaddleEvent
  try {
    event = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }
  try {
    const outcome = await handlePaddleEvent(event)
    return NextResponse.json({ ok: true, outcome })
  } catch (error) {
    if (error instanceof LocalDataError && error.status < 500) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('paddle webhook failed', event?.event_type, event?.event_id, error)
    return NextResponse.json({ error: 'Could not process the event.' }, { status: 500 })
  }
}

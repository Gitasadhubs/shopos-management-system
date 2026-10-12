import { paymentRoute } from '@/lib/party-routes'

export const runtime = 'nodejs'

// The shop pays a supplier, lowering what it owes them.
export const POST = paymentRoute('suppliers')

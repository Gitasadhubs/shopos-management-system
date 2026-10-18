import { paymentRoute } from '@/lib/party-routes'

export const runtime = 'nodejs'

// A customer pays towards their balance (khata).
export const POST = paymentRoute('customers')

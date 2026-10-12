import { archiveRoute, detailRoute, updateRoute } from '@/lib/party-routes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// A customer's khata: details and ledger (GET), edit (PUT), remove once settled (DELETE).
export const GET = detailRoute('customers')
export const PUT = updateRoute('customers')
export const DELETE = archiveRoute('customers')

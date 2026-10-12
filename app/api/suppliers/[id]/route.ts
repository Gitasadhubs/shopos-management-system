import { archiveRoute, detailRoute, updateRoute } from '@/lib/party-routes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// A supplier and what the shop owes them (GET), edit (PUT), remove once settled (DELETE).
export const GET = detailRoute('suppliers')
export const PUT = updateRoute('suppliers')
export const DELETE = archiveRoute('suppliers')

import { createRoute, listRoute } from '@/lib/party-routes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Customers (khata): list and create, shared with suppliers in lib/party-routes.ts.
export const GET = listRoute('customers')
export const POST = createRoute('customers')

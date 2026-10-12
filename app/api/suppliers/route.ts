import { createRoute, listRoute } from '@/lib/party-routes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = listRoute('suppliers')
export const POST = createRoute('suppliers')

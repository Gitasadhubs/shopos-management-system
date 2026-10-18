import { jsonResponse, withShop } from '@/lib/local-session'
import { getLocalDashboardStats } from '@/lib/local-db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// "Today" follows the shop's time zone (Settings), not the server's.
export async function GET(request: Request) {
  return withShop(request, 'dashboard', 'Unable to load dashboard statistics.', async ({ shop }) => jsonResponse(await getLocalDashboardStats(shop.id, shop.timezone)))
}

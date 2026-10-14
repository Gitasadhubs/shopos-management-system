import { z } from 'zod'
import { getLocalSale } from '@/lib/local-db'
import { jsonResponse, withShop } from '@/lib/local-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// One sale with its items and returns, for the receipt and the return screen.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withShop(request, 'pos', 'Unable to load the sale.', async ({ shop }) => {
    const id = (await params).id
    const sale = z.string().uuid().safeParse(id).success ? await getLocalSale(shop.id, id) : null
    return sale ? jsonResponse(sale) : jsonResponse(null, 'Sale not found.', 404)
  })
}
